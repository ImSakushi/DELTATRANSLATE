import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import storage from "../storage.js";
import { runTool } from "./process-runner.mjs";
import { launcherPaths, launcherLanguages, prepareLauncherGml } from "./launcher-language.mjs";
import { makeDonorFontsCsx, fontImportCsx, donorFontFiles, previewFontsCsx } from "./language-fonts.mjs";
import { prepareMultilangGml, MULTILANG_VERSION } from "./multilang-gml.mjs";
import { normalizeLanguage, installedLanguages, prepareLanguage } from "./languages.mjs";

export const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cs = (value) => JSON.stringify(value);

function previewSpritesCsx(workspace, languages) {
  const directory = path.join(workspace, "sprites");
  // Des milliers de blocs C# dans Initialize font déborder la pile du moteur de scripts.
  return `string spriteFolder = ${cs(directory)};
string[] previewLanguages = new string[] { ${languages.map(cs).join(", ")} };
if (Directory.Exists(spriteFolder))
{
    var requested = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
    string[] previewFiles = Directory.GetFiles(spriteFolder);
    using (TextureWorker worker = new())
    {
        foreach (string file in previewFiles)
        {
            var match = System.Text.RegularExpressions.Regex.Match(Path.GetFileName(file), @"^(.+)_([0-9]+)\\.png$");
            if (!match.Success || !int.TryParse(match.Groups[2].Value, out int frame)) continue;
            string baseName = match.Groups[1].Value;
            string suffix = previewLanguages.FirstOrDefault(code => baseName.EndsWith("_" + code, StringComparison.Ordinal));
            if (suffix != null) baseName = baseName.Substring(0, baseName.Length - suffix.Length - 1);
            foreach (string language in previewLanguages)
            {
                string name = baseName + "_" + language;
                string filename = name + "_" + frame + ".png";
                if (!requested.Add(filename)) continue;
                var sprite = Data.Sprites.ByName(name);
                if (sprite != null && sprite.Textures.Count > frame && sprite.Textures[frame]?.Texture != null)
                    worker.ExportAsPNG(sprite.Textures[frame].Texture, Path.Combine(spriteFolder, filename), null, true);
            }
        }
    }
}
`;
}

export async function runUtmt(cli, args, marker, log) {
  const result = await runTool(cli, args);
  if (result.error || result.status !== 0 || !result.stdout?.includes(marker)) {
    throw new Error(`UTMT : ${result.error?.message ?? `échec ${marker}`}\n${(result.stdout ?? "").slice(-4500)}\n${(result.stderr ?? "").slice(-1500)}`);
  }
  log(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("DT_")).join("\n"));
}

export function makeLanguageCompileCsx({ patchDir, languages, spriteRoot, fontRoot }) {
  const clone = fs.readFileSync(new URL("./clone-language-resources.csx", import.meta.url), "utf8");
  return `using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using ImageMagick;
using UndertaleModLib;
using UndertaleModLib.Models;
using UndertaleModLib.Compiler;
using UndertaleModLib.Util;
EnsureDataLoaded();
${clone}
string[] languages = new string[] { ${languages.map(cs).join(", ")} };
bool IsVariant(string name) => languages.Any(code => name.EndsWith("_" + code, StringComparison.Ordinal) &&
    (Data.Sprites.ByName(name.Substring(0, name.Length - code.Length - 1)) != null || Data.Fonts.ByName(name.Substring(0, name.Length - code.Length - 1)) != null));
var sprites = Data.Sprites.Where(s => !IsVariant(s.Name.Content)).ToArray();
var fonts = Data.Fonts.Where(f => !IsVariant(f.Name.Content) && !f.Name.Content.Contains("ja_")).ToArray();
int added = 0;
foreach (var language in languages)
{
    foreach (var sprite in sprites)
    {
        string name = sprite.Name.Content + "_" + language;
        if (Data.Sprites.ByName(name) == null) { Data.Sprites.Add(CloneSprite(sprite, name)); added++; }
    }
    foreach (var font in fonts)
    {
        string name = font.Name.Content + "_" + language;
        if (Data.Fonts.ByName(name) != null) continue;
        var copy = new UndertaleFont();
        foreach (var property in typeof(UndertaleFont).GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (!property.CanRead || !property.CanWrite || property.GetIndexParameters().Length != 0 || property.Name == "Name" || property.Name == "Glyphs") continue;
            property.SetValue(copy, property.GetValue(font));
        }
        copy.Name = Data.Strings.MakeString(name);
        // Les atlas sont immuables ; les glyphes et leurs crénages sont indépendants.
        if (ReferenceEquals(copy.Glyphs, font.Glyphs)) throw new Exception("Table de glyphes partagée : " + name);
        copy.Glyphs.Clear();
        foreach (var glyph in font.Glyphs)
        {
            var g = new UndertaleFont.Glyph { Character = glyph.Character, SourceX = glyph.SourceX, SourceY = glyph.SourceY,
                SourceWidth = glyph.SourceWidth, SourceHeight = glyph.SourceHeight, Shift = glyph.Shift, Offset = glyph.Offset };
            foreach (var kerning in glyph.Kerning) g.Kerning.Add(new UndertaleFont.Glyph.GlyphKerning { Character = kerning.Character, ShiftModifier = kerning.ShiftModifier });
            copy.Glyphs.Add(g);
        }
        Data.Fonts.Add(copy);
    }
}
${fontImportCsx(fontRoot)}
string spriteRoot = ${cs(spriteRoot)};
int frames = 0;
foreach (string language in languages)
{
    string folder = Path.Combine(spriteRoot, language);
    if (!Directory.Exists(folder)) continue;
    foreach (string directory in Directory.GetDirectories(folder))
    {
        string name = Path.GetFileName(directory);
        if (!name.EndsWith("_" + language, StringComparison.Ordinal)) throw new Exception("Sprite hors de sa langue : " + name);
        var sprite = Data.Sprites.ByName(name) ?? throw new Exception("Sprite introuvable : " + name);
        foreach (string file in Directory.GetFiles(directory, "*.png"))
        {
            if (!int.TryParse(Path.GetFileNameWithoutExtension(file), out int frame) || frame < 0 || frame >= sprite.Textures.Count) throw new Exception("Frame invalide : " + file);
            using MagickImage image = TextureWorker.ReadBGRAImageFromFile(file);
            if (image.Width != sprite.Width || image.Height != sprite.Height) throw new Exception("Dimensions invalides : " + file);
            var texture = new UndertaleEmbeddedTexture { Name = Data.Strings.MakeString("DT_Texture_" + Data.EmbeddedTextures.Count) };
            texture.TextureData.Image = GMImage.FromMagickImage(image).ConvertToPng();
            Data.EmbeddedTextures.Add(texture);
            var item = new UndertaleTexturePageItem { Name = Data.Strings.MakeString("DT_Page_" + Data.TexturePageItems.Count),
                SourceWidth = (ushort)image.Width, SourceHeight = (ushort)image.Height,
                TargetWidth = (ushort)image.Width, TargetHeight = (ushort)image.Height,
                BoundingWidth = (ushort)image.Width, BoundingHeight = (ushort)image.Height, TexturePage = texture };
            Data.TexturePageItems.Add(item);
            sprite.Textures[frame].Texture = item;
            frames++;
        }
    }
}
var controller = Data.GameObjects.ByName("obj_dt_languages");
if (controller == null)
{
    controller = new UndertaleGameObject { Name = Data.Strings.MakeString("obj_dt_languages"), Persistent = true };
    Data.GameObjects.Add(controller);
}
CodeImportGroup imports = new(Data) { MainThreadAction = MainThreadAction };
bool HasDraw(UndertaleGameObject obj)
{
    for (var current = obj; current != null; current = current.ParentId)
        if (current.Events[(int)EventType.Draw].Any(e => e.EventSubtype == 0)) return true;
    return false;
}
foreach (var obj in Data.GameObjects.ToArray())
    if (obj.Sprite != null && !HasDraw(obj))
        imports.QueueReplace(obj.EventHandlerFor(EventType.Draw, (uint)0, Data), "dt_draw_self();");
imports.QueueReplace(controller.EventHandlerFor(EventType.Step, (uint)2, Data), "dt_refresh_sprites();");
imports.QueueReplace(controller.EventHandlerFor(EventType.Other, (uint)4, Data), "dt_refresh_sprites();");
foreach (string file in Directory.GetFiles(${cs(patchDir)}, "*.gml")) imports.QueueReplace(Path.GetFileNameWithoutExtension(file), File.ReadAllText(file));
imports.Import();
ScriptMessage("DT_COMPILED sprites=" + added + " frames=" + frames);
`;
}

export function makeLanguageVerifyCsx({ languages, reportPath, workspace, source }) {
  return `using System;
using System.IO;
using System.Linq;
using UndertaleModLib;
using UndertaleModLib.Models;
using UndertaleModLib.Util;
EnsureDataLoaded();
UndertaleData original;
var originalStream = File.OpenRead(${cs(source)});
original = UndertaleIO.Read(originalStream);
string[] languages = new string[] { ${languages.map(cs).join(", ")} };
bool IsLanguageVariant(string name) => languages.Any(code => name.EndsWith("_" + code, StringComparison.Ordinal));
for (int i = 0; i < original.EmbeddedTextures.Count; i++)
    if (!original.EmbeddedTextures[i].TextureData.Image.ConvertToRawBgra().GetRawImageData().SequenceEqual(Data.EmbeddedTextures[i].TextureData.Image.ConvertToRawBgra().GetRawImageData()))
        throw new Exception("Texture originale modifiée : " + i);
string TextureIdentity(UndertaleTexturePageItem texture, UndertaleData data) => texture == null ? "null" :
    string.Join(",", texture.SourceX, texture.SourceY, texture.SourceWidth, texture.SourceHeight, texture.TargetX, texture.TargetY,
        texture.TargetWidth, texture.TargetHeight, texture.BoundingWidth, texture.BoundingHeight, data.EmbeddedTextures.IndexOf(texture.TexturePage));
foreach (var sprite in original.Sprites)
{
    if (IsLanguageVariant(sprite.Name.Content)) continue;
    var actual = Data.Sprites.ByName(sprite.Name.Content) ?? throw new Exception("Sprite original absent");
    if (sprite.Width != actual.Width || sprite.Height != actual.Height || sprite.OriginX != actual.OriginX || sprite.OriginY != actual.OriginY || sprite.Textures.Count != actual.Textures.Count)
        throw new Exception("Sprite original altéré : " + sprite.Name.Content);
    for (int i = 0; i < sprite.Textures.Count; i++)
        if (TextureIdentity(sprite.Textures[i]?.Texture, original) != TextureIdentity(actual.Textures[i]?.Texture, Data))
            throw new Exception("Frame originale altérée : " + sprite.Name.Content);
}
foreach (var font in original.Fonts)
{
    if (IsLanguageVariant(font.Name.Content)) continue;
    var actual = Data.Fonts.ByName(font.Name.Content) ?? throw new Exception("Police originale absente");
    string Glyphs(UndertaleFont f) => string.Join(";", f.Glyphs.Select(g => string.Join(",", g.Character, g.SourceX, g.SourceY, g.SourceWidth, g.SourceHeight, g.Shift, g.Offset) +
        ":" + string.Join("/", g.Kerning.Select(k => k.Character + "," + k.ShiftModifier))));
    if (font.EmSize != actual.EmSize || font.Ascender != actual.Ascender || font.AscenderOffset != actual.AscenderOffset || font.LineHeight != actual.LineHeight ||
        Glyphs(font) != Glyphs(actual) || TextureIdentity(font.Texture, original) != TextureIdentity(actual.Texture, Data))
        throw new Exception("Police originale altérée : " + font.Name.Content);
}
if (original.EmbeddedAudio.Count != Data.EmbeddedAudio.Count) throw new Exception("Audio original altéré");
for (int i = 0; i < original.EmbeddedAudio.Count; i++)
    if (!original.EmbeddedAudio[i].Data.SequenceEqual(Data.EmbeddedAudio[i].Data)) throw new Exception("Audio original altéré : " + i);
ScriptMessage("DT_ORIGINALS_VERIFIED sprites=" + original.Sprites.Count + " fonts=" + original.Fonts.Count);
originalStream.Dispose();
string cycle = GetDecompiledText(Data.Code.ByName("gml_GlobalScript_scr_change_language"));
if (!cycle.Contains("${MULTILANG_VERSION}") || !cycle.Contains("dt_next_language")) throw new Exception("Cycle de langue absent");
foreach (string language in languages) if (!cycle.Contains("\\\"" + language + "\\\"")) throw new Exception("Langue absente : " + language);
if (Data.GameObjects.ByName("obj_dt_languages") == null) throw new Exception("Résolveur de sprites absent");
string init = GetDecompiledText(Data.Code.ByName("gml_GlobalScript_scr_84_init_localization"));
if (!init.Contains("obj_dt_languages")) throw new Exception("Initialisation du résolveur absente");
string load = GetDecompiledText(Data.Code.ByName("gml_GlobalScript_scr_84_lang_load"));
if (!load.Contains("global.lang")) throw new Exception("Chargement de langue absent");
Directory.CreateDirectory(${cs(reportPath)});
File.WriteAllText(Path.Combine(${cs(reportPath)}, "cycle.gml"), cycle);
File.WriteAllText(Path.Combine(${cs(reportPath)}, "init.gml"), init);
File.WriteAllText(Path.Combine(${cs(reportPath)}, "load.gml"), load);
File.WriteAllLines(Path.Combine(${cs(reportPath)}, "sprites.txt"), Data.Sprites.Select(s => s.Name.Content));
${previewFontsCsx(workspace)}
${previewSpritesCsx(workspace, languages)}
ScriptMessage("DT_VERIFIED");
`;
}

export async function buildLanguageDataWin({ source, output, cli, codeDir, languages, workspace, log = console.log }) {
  const fontWarnings = [];
  const buildLog = (message) => {
    for (const line of message.split(/\r?\n/)) {
      if (line.startsWith("DT_FONT_SKIPPED ")) fontWarnings.push(line.slice("DT_FONT_SKIPPED ".length));
    }
    log(message);
  };
  const identity = (file) => {
    const resolved = fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (identity(source) === identity(output)) throw new Error("La sortie doit être distincte du data.win source.");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-language-build-"));
  try {
    const patchDir = path.join(temporary, "CodeEntries");
    const changed = prepareMultilangGml({ codeDir, outputDir: patchDir, languages,
      overridesDir: path.join(workspace, "CodeOverrides") });
    log(`Mod multilingue : compilation de ${changed.length} entrées, langues ${languages.join(", ")}…`);
    const compile = path.join(temporary, "compile.csx");
    fs.writeFileSync(compile, makeLanguageCompileCsx({ patchDir, languages, spriteRoot: path.join(workspace, "LanguageSprites"), fontRoot: path.join(workspace, "LanguageFonts") }));
    await runUtmt(cli, ["load", source, "-s", compile, "-o", output], "DT_COMPILED", buildLog);
    if (!fs.existsSync(output) || fs.statSync(output).size < 1024) throw new Error("Aucun data.win produit.");
    log("Vérification du mod : rechargement et redécompilation du résultat…");
    const verify = path.join(temporary, "verify.csx");
    fs.writeFileSync(verify, makeLanguageVerifyCsx({ languages, reportPath: path.join(workspace, "multilang-verification"), workspace, source }));
    await runUtmt(cli, ["load", output, "-s", verify], "DT_VERIFIED", log);
    return { version: MULTILANG_VERSION, languages, patchedEntries: changed, outputHash: hashFile(output), fontWarnings: [...new Set(fontWarnings)] };
  } finally {
    if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Dossier temporaire invalide.");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// Sauvegarde durable et restauration de tous les fichiers en cas d’échec partiel.
export function installTransaction(files, backupRoot) {
  for (const file of files) {
    if (Object.hasOwn(file, "expected")) storage.assertRevision(file.target, file.expected);
  }
  const backup = path.join(backupRoot, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`);
  fs.mkdirSync(backup, { recursive: true });
  const originals = files.map(({ target }, index) => {
    const saved = path.join(backup, `${index}-${path.basename(target)}`);
    const exists = fs.existsSync(target);
    if (exists) fs.copyFileSync(target, saved, fs.constants.COPYFILE_EXCL);
    return { target, saved, exists };
  });
  storage.atomicWrite(path.join(backup, "manifest.json"), JSON.stringify(originals, null, 2), { json: true });
  try {
    for (const [index, file] of files.entries()) {
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      storage.atomicWrite(file.target, fs.readFileSync(file.source));
      if (hashFile(file.source) !== hashFile(file.target)) throw new Error(`Copie invalide : ${file.target}`);
    }
  } catch (error) {
    // Inclure la copie éventuellement interrompue avant son retour.
    restoreTransaction(backup);
    throw error;
  }
  return backup;
}

export function restoreTransaction(backup) {
  const originals = storage.readJson(path.join(backup, "manifest.json"));
  for (const previous of originals.toReversed()) {
    if (path.dirname(path.resolve(previous.saved)) !== path.resolve(backup)) throw new Error("Chemin de sauvegarde invalide.");
    if (previous.exists) storage.atomicWrite(previous.target, fs.readFileSync(previous.saved));
    else if (fs.existsSync(previous.target)) fs.unlinkSync(previous.target);
  }
}

export function assertGameClosed(dataWin) {
  if (process.platform !== "win32") return;
  const root = launcherPaths(dataWin)?.root ?? path.dirname(path.resolve(dataWin));
  const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    '$root = $env:DT_GAME_ROOT.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar; Get-CimInstance Win32_Process | Where-Object { $_.Name -match "(?i)deltarune|runedelta" -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }'],
  { encoding: "utf8", windowsHide: true, timeout: 15000, env: { ...process.env, DT_GAME_ROOT: root } });
  if (check.error || check.status !== 0) throw new Error("Impossible de vérifier si le jeu est fermé.");
  if (check.stdout.trim()) throw new Error("Ferme DELTARUNE avant d’installer une langue ou ses sprites.");
}

async function prepareLauncherFiles({ dataWin, language, cli, staged, log, force }) {
  const paths = launcherPaths(dataWin);
  if (!paths) return [];
  const { root, target } = paths;
  const hash = hashFile(target);
  const manifestFile = path.join(root, "deltatranslate-launcher.json");
  const manifest = storage.readJson(manifestFile, {});
  const manifestRevision = storage.revision(manifestFile);
  const languages = launcherLanguages(root, language);
  if (!force && manifest.version === MULTILANG_VERSION && manifest.hash === hash && JSON.stringify(manifest.languages) === JSON.stringify(languages)) return [];
  const source = manifest.hash === hash && fs.existsSync(manifest.source)
    ? manifest.source : path.join(root, `data-deltatranslate-launcher-${hash.slice(0, 16)}.win`);
  if (!fs.existsSync(source)) fs.copyFileSync(target, source, fs.constants.COPYFILE_EXCL);
  const code = path.join(staged, "launcher-code");
  const patches = path.join(staged, "launcher-patches");
  fs.mkdirSync(code);
  const exportScript = path.join(staged, "launcher-export.csx");
  fs.writeFileSync(exportScript, `using System.IO;\nusing System.Linq;\nEnsureDataLoaded();\nforeach (var entry in Data.Code.Where(c => c.ParentEntry == null)) File.WriteAllText(Path.Combine(${cs(code)}, entry.Name.Content + ".gml"), GetDecompiledText(entry));\nScriptMessage("DT_LAUNCHER_EXPORTED");`);
  log("Préparation du sélecteur de langues dans le lanceur…");
  await runUtmt(cli, ["load", source, "-s", exportScript], "DT_LAUNCHER_EXPORTED", log);
  prepareLauncherGml(code, patches, languages);
  const compile = path.join(staged, "launcher-compile.csx");
  fs.writeFileSync(compile, `using System.IO;\nEnsureDataLoaded();\nUndertaleModLib.Compiler.CodeImportGroup imports = new(Data) { MainThreadAction = MainThreadAction };\nforeach (string file in Directory.GetFiles(${cs(patches)}, "*.gml")) imports.QueueReplace(Path.GetFileNameWithoutExtension(file), File.ReadAllText(file));\nimports.Import();\nScriptMessage("DT_LAUNCHER_COMPILED");`);
  const output = path.join(staged, "launcher.win");
  await runUtmt(cli, ["load", source, "-s", compile, "-o", output], "DT_LAUNCHER_COMPILED", log);
  const verify = path.join(staged, "launcher-verify.csx");
  fs.writeFileSync(verify, `using System;\nEnsureDataLoaded();\nstring helper = GetDecompiledText(Data.Code.ByName("gml_GlobalScript_scr_init"));\nif (!helper.Contains("dt_launcher_codes") || !helper.Contains(${cs('"' + language + '"')})) throw new Exception("Langue absente du lanceur");\nScriptMessage("DT_LAUNCHER_VERIFIED");`);
  await runUtmt(cli, ["load", output, "-s", verify], "DT_LAUNCHER_VERIFIED", log);
  if (hashFile(target) !== hash) throw new Error("Le lanceur a changé pendant sa compilation.");
  const manifestStage = path.join(staged, "launcher.json");
  fs.writeFileSync(manifestStage, JSON.stringify({ version: MULTILANG_VERSION, source, hash: hashFile(output), languages }));
  return [{ source: output, target, expected: hash }, { source: manifestStage, target: manifestFile, expected: manifestRevision }];
}

export async function installLanguage({ dataWin, source, cli, codeDir, workspace, reference, language, fontDonor, force = false, log = console.log, beforeInstall = async () => {} }) {
  assertGameClosed(dataWin);
  const code = normalizeLanguage(language);
  const gameDir = path.dirname(dataWin);
  const langDir = path.join(gameDir, "lang");
  const prepared = prepareLanguage({ reference, language: code, langDir, workspace });
  const languageRevision = storage.revision(prepared.target);
  const manifestPath = path.join(workspace, "multilang-install.json");
  const languages = [...new Set([...installedLanguages(langDir), code])].sort();
  const targetHash = hashFile(dataWin);
  let previous = null;
  if (fs.existsSync(manifestPath)) previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const unchanged = !force && !fontDonor && previous?.version === MULTILANG_VERSION && previous.outputHash === targetHash &&
    JSON.stringify(previous.languages) === JSON.stringify(languages);
  const staged = path.join(workspace, `language-stage-${randomUUID()}`);
  fs.mkdirSync(staged);
  try {
    const legacySprites = path.join(workspace, "SpriteOverrides");
    const languageSprites = path.join(workspace, "LanguageSprites", code);
    if (code === "fr" && fs.existsSync(legacySprites) && !fs.existsSync(languageSprites)) {
      fs.mkdirSync(languageSprites, { recursive: true });
      for (const entry of fs.readdirSync(legacySprites, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_]+$/.test(entry.name)) continue;
        const name = entry.name.endsWith("_fr") ? entry.name : `${entry.name}_fr`;
        fs.cpSync(path.join(legacySprites, entry.name), path.join(languageSprites, name), { recursive: true, force: false, errorOnExist: true });
      }
    }
    if (fontDonor) {
      if (!fs.existsSync(fontDonor)) throw new Error("Le data.win donneur de polices est introuvable.");
      const donor = donorFontFiles(workspace, code);
      if (path.dirname(path.resolve(donor.root)) !== path.resolve(workspace, "LanguageFonts")) throw new Error("Dossier des polices invalide.");
      fs.rmSync(donor.root, { recursive: true, force: true });
      fs.mkdirSync(donor.root, { recursive: true });
      fs.writeFileSync(donor.script, makeDonorFontsCsx(donor.root));
      log(`Import des polices du mod donneur pour ${code.toUpperCase()}…`);
      await runUtmt(cli, ["load", fontDonor, "-s", donor.script], "DT_DONOR_FONTS", log);
      fs.unlinkSync(donor.script);
    }
    const langStage = path.join(staged, `lang_${code}.json`);
    fs.writeFileSync(langStage, prepared.content);
    let report = previous;
    const files = [{ source: langStage, target: prepared.target, expected: languageRevision }];
    if (!unchanged) {
      const output = path.join(staged, "data.win");
      report = await buildLanguageDataWin({ source, output, cli, codeDir, languages, workspace, log });
      if (hashFile(dataWin) !== targetHash) throw new Error("Le jeu a changé pendant la compilation. Relance la préparation.");
      files.push({ source: output, target: dataWin, expected: targetHash });
    }
    files.push(...await prepareLauncherFiles({ dataWin, language: code, cli, staged, log, force }));
    assertGameClosed(dataWin);
    await beforeInstall();
    storage.assertRevision(dataWin, targetHash);
    const backup = installTransaction(files, path.join(gameDir, "deltatranslate-backups"));
    try { storage.atomicWrite(manifestPath, JSON.stringify({ ...report, source, sourceHash: hashFile(source), backup }, null, 2), { json: true }); }
    catch (error) { restoreTransaction(backup); throw error; }
    return { langFrPath: prepared.target, targetLanguage: code, storageMode: "lang-json", multilang: true, languages, installationBackup: backup, fontWarnings: report?.fontWarnings ?? [] };
  } finally {
    if (!path.resolve(staged).startsWith(path.resolve(workspace) + path.sep)) throw new Error("Dossier de préparation invalide.");
    fs.rmSync(staged, { recursive: true, force: true });
  }
}
