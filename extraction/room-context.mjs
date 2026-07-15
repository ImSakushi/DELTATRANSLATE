// Contexte visuel automatique : relie les objets qui émettent du texte aux
// rooms qui les contiennent, puis attache les vues extraites par UTMT.
import fs from "node:fs";
import path from "node:path";

const OBJECT_FILE_RE = /^gml_Object_(.+)_(?:Create|Step|Draw|Other|Alarm|Destroy|CleanUp|PreCreate)_\d+$/;
const INSTANCE_CREATE_RE = /\binstance_create(?:_layer|_depth)?\s*\([\s\S]{0,500}?\b(obj_[A-Za-z0-9_]+)\s*\)/g;
const ROOM_RE = /\broom_[A-Za-z0-9_]+\b/g;
const STATIC_CAMERA_RE =
  /\bc_(?:pan|pan_wait|panspeed|panspeed_wait|pan_fancy)\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/;

export function objectFromCodeFile(file) {
  return String(file ?? "").replace(/\.gml$/, "").match(OBJECT_FILE_RE)?.[1] ?? null;
}

function scanCreationGraph(codeDir) {
  const creators = new Map();
  const roomsByObject = new Map();
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const owner = objectFromCodeFile(file);
    if (!owner) continue;
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    for (const match of source.matchAll(INSTANCE_CREATE_RE)) {
      if (!creators.has(match[1])) creators.set(match[1], new Set());
      creators.get(match[1]).add(owner);
    }
    for (const room of source.matchAll(ROOM_RE)) {
      if (!roomsByObject.has(owner)) roomsByObject.set(owner, new Set());
      roomsByObject.get(owner).add(room[0]);
    }
  }
  return { creators, roomsByObject };
}

export function collectRoomContextRequests(reference, codeDir) {
  const directObjects = new Set();
  for (const entry of Object.values(reference)) {
    // Le décor de room n'a de sens que derrière une textbox. Les libellés de
    // menus/inventaire partagent souvent un objet global présent partout.
    if (entry.channel === "string" && !entry.smallFace && entry.previewMode !== "shop")
      continue;
    const owner = objectFromCodeFile(entry.file);
    if (owner) directObjects.add(owner);
  }

  const { creators, roomsByObject } = scanCreationGraph(codeDir);
  const objects = new Set(directObjects);
  let frontier = [...directObjects];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next = [];
    for (const target of frontier) {
      for (const creator of creators.get(target) ?? []) {
        if (objects.has(creator)) continue;
        objects.add(creator);
        next.push(creator);
      }
    }
    frontier = next;
  }

  const rooms = new Set();
  for (const object of objects) {
    for (const room of roomsByObject.get(object) ?? []) rooms.add(room);
  }
  const cameraViews = new Set();
  const lineCache = new Map();
  for (const entry of Object.values(reference)) {
    if (entry.channel === "string" && !entry.smallFace && entry.previewMode !== "shop")
      continue;
    const owner = objectFromCodeFile(entry.file);
    if (!owner || !entry.line) continue;
    if (!lineCache.has(entry.file)) {
      const file = path.join(codeDir, `${entry.file}.gml`);
      lineCache.set(entry.file, fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : []);
    }
    const camera = findStaticCamera(lineCache.get(entry.file), entry.line - 1);
    if (camera) cameraViews.add(`${owner}|${camera.x}|${camera.y}`);
  }
  return {
    objects: [...objects].sort(),
    rooms: [...rooms].sort(),
    cameraViews: [...cameraViews].sort(),
  };
}

function csStrings(values) {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

export function makeRoomContextCsx(outDir, requests) {
  const template = fs.readFileSync(
    path.join(import.meta.dirname, "export-room-context.csx"),
    "utf8"
  );
  return template
    .replace("__OUT_ROOT__", outDir.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))
    .replace("__REQUESTED_OBJECTS__", csStrings(requests.objects))
    .replace("__REQUESTED_ROOMS__", csStrings(requests.rooms))
    .replace("__REQUESTED_CAMERA_VIEWS__", csStrings(requests.cameraViews ?? []));
}

function findStaticCamera(lines, lineIdx) {
  for (let index = lineIdx; index >= Math.max(0, lineIdx - 500); index--) {
    const match = lines[index]?.match(STATIC_CAMERA_RE);
    if (!match) continue;
    return { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) };
  }
  return null;
}

function uniqueContexts(contexts) {
  const seen = new Set();
  return contexts.filter((context) => {
    const key = `${context.image}|${context.focusX}|${context.focusY}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function attachRoomContexts(reference, codeDir, extractedDir, log = () => {}) {
  const contextPath = path.join(extractedDir, "room-context.json");
  if (!fs.existsSync(contextPath)) return reference;
  const raw = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  const { creators, roomsByObject } = scanCreationGraph(codeDir);
  let attached = 0;
  let exact = 0;
  const lineCache = new Map();

  for (const entry of Object.values(reference)) {
    if (entry.channel === "string" && !entry.smallFace && entry.previewMode !== "shop")
      continue;
    const owner = objectFromCodeFile(entry.file);
    if (!owner) continue;
    if (!lineCache.has(entry.file)) {
      const sourcePath = path.join(codeDir, `${entry.file}.gml`);
      lineCache.set(
        entry.file,
        fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8").split(/\r?\n/) : []
      );
    }
    const lines = lineCache.get(entry.file);
    const camera = findStaticCamera(lines, (entry.line || 1) - 1);
    const cameraKey = camera ? `${camera.x}:${camera.y}` : null;
    let contexts = (cameraKey ? raw.cameraViews?.[owner]?.[cameraKey] ?? [] : []).map(
      (context) => ({
        ...context,
        confidence: "camera-exact",
        reason: `caméra c_pan(${camera.x}, ${camera.y})`,
      })
    );
    if (!contexts.length) contexts = (raw.objects?.[owner] ?? []).map((context) => ({
      ...context,
      confidence: context.via === "direct" ? "exact" : "high",
      reason:
        context.via === "direct"
          ? `instance de ${owner}`
          : `instance héritée de ${owner}`,
    }));

    if (!contexts.length) {
      const visited = new Set([owner]);
      let frontier = [owner];
      for (let depth = 0; depth < 4 && frontier.length && !contexts.length; depth++) {
        const next = [];
        for (const target of frontier) {
          for (const creator of creators.get(target) ?? []) {
            if (visited.has(creator)) continue;
            visited.add(creator);
            next.push(creator);
            contexts.push(
              ...(raw.objects?.[creator] ?? []).map((context) => ({
                ...context,
                confidence: "inferred",
                reason: `${owner} créé par ${creator}`,
              }))
            );
          }
        }
        frontier = next;
      }
    }

    if (!contexts.length) {
      for (const room of roomsByObject.get(owner) ?? []) {
        const context = raw.rooms?.[room];
        if (context) {
          contexts.push({
            ...context,
            confidence: "inferred",
            reason: `${room} référencée dans le GML`,
          });
        }
      }
    }

    contexts = uniqueContexts(contexts);
    if (!contexts.length) continue;
    entry.sceneContexts = contexts;
    attached++;
    if (
      contexts.some(
        (context) => context.confidence === "exact" || context.confidence === "camera-exact"
      )
    )
      exact++;
  }

  log(`  contexte de room : ${attached} textes reliés (${exact} contextes certains)`);
  return reference;
}
