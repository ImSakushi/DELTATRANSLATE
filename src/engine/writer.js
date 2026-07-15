// Réimplémentation fidèle du formatage et du rendu de texte de DELTARUNE Ch5 :
// - word-wrap automatique : gml_Object_obj_writer_Other_15
// - interprétation des codes de contrôle : gml_Object_obj_writer_Draw_0
import { TYPERS, T_TAG, C_TAG, F_TAG, decodeFe, resolveTyper } from "./typers.js";

// substringargs.gml : remplace ~1, ~2, ... dans l'ordre, avant la création du
// writer. Les valeurs nulles correspondent aux arguments dépendant de l'état
// de la partie, impossibles à déterminer depuis le seul data.win ; `samples`
// fournit alors une valeur d'exemple extraite du GML (voir sampleSubstitution
// dans extraction/import-lib.mjs), signalée dans `sampled`.
export function substituteArgs(input, substitutions = [], samples = []) {
  let text = input;
  for (let index = 0; index < substitutions.length; index++) {
    const value = substitutions[index];
    if (typeof value === "string") text = text.replaceAll(`~${index + 1}`, value);
  }

  const sampled = [];
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index];
    if (typeof value === "string" && text.includes(`~${index + 1}`)) {
      text = text.replaceAll(`~${index + 1}`, value);
      sampled.push({ index: index + 1, value });
    }
  }

  const unresolved = [
    ...new Set([...text.matchAll(/~(\d+)/g)].map((match) => Number(match[1]))),
  ].sort((a, b) => a - b);
  return { text, unresolved, sampled };
}

// ---------------------------------------------------------------------------
// Passe 1 : word-wrap (obj_writer event_user(5))
// Retourne { text, linecount, stringmax, fc, fe }
// ---------------------------------------------------------------------------
export function formatText(input, opts) {
  const {
    charline: baseCharline = 33,
    dialoguer = false,
    battle = false,
    initialFc = 0,
  } = opts;

  let mystring = input;
  let charline = baseCharline;
  const originalcharline = baseCharline;
  let fc = initialFc;
  let fe = 0;
  if (dialoguer && fc !== 0 && charline === 33) charline = 26;

  let length = mystring.length;
  let charpos = -1;
  let remspace = -1;
  let remchar = -1;
  let linecount = 0;
  let stringmax = 0;
  let aster = 0;
  const autoaster = true;

  const charAt = (s, i) => s.charAt(i - 1); // GML : indexé à partir de 1

  // scr_asterskip : après un wrap sur une ligne à astérisque, insérer "||"
  // juste après le & (à la position 1-indexée `pos`) pour aligner le texte
  function asterskip(pos) {
    if (aster === 1 && autoaster) {
      mystring = mystring.slice(0, pos - 1) + "||" + mystring.slice(pos - 1);
      length += 2;
    }
  }

  for (let i = 0; i < length + 1; i += 1) {
    let skip = 0;
    const thischar = charAt(mystring, i);
    if (thischar === "`") {
      i++;
    } else if (thischar === "/" || thischar === "%") {
      if (charpos > -1) charpos -= 1;
    } else if (thischar === "^") {
      if (charpos > -1) charpos -= 2;
    } else if (thischar === "\\") {
      if (charpos > -1) charpos -= 3;
      const nextchar = charAt(mystring, i + 1);
      const nextchar2 = charAt(mystring, i + 2);
      if (nextchar === "E") fe = decodeFe(nextchar2);
      if (nextchar === "F") {
        if (nextchar2 in F_TAG) fc = F_TAG[nextchar2];
        if (dialoguer) {
          if (fc === 0) charline = originalcharline;
          else charline = 26;
        }
      }
    } else if (thischar === "&" || thischar === "\n") {
      if (charpos > stringmax) stringmax = charpos;
      remspace = -1;
      charpos = 0;
      linecount += 1;
      skip = 1;
      const nextchar = charAt(mystring, i + 1);
      if (aster === 1 && autoaster && nextchar !== "*") {
        charpos = 2;
        length += 2;
        mystring = mystring.slice(0, i) + "||" + mystring.slice(i);
        i += 2;
      }
    }
    if (skip === 0) {
      if (thischar === " ") {
        remspace = i;
        remchar = charpos;
      }
      if (thischar === "*") aster = 1;
      let effCharline = charline;
      if (battle) {
        effCharline = fc !== 0 ? 29 : 37;
      }
      if (charpos >= effCharline) {
        if (remspace > 2) {
          // remplace le dernier espace par &
          mystring =
            mystring.slice(0, remspace - 1) + "&" + mystring.slice(remspace);
          i = remspace + 1;
          if (remchar > stringmax) stringmax = remchar;
          remspace = -1;
          charpos = 1;
          linecount += 1;
          asterskip(i);
        } else {
          if (charpos > stringmax) stringmax = charpos;
          mystring = mystring.slice(0, i - 1) + "&" + mystring.slice(i - 1);
          length += 1;
          charpos = 1;
          remspace = -1;
          linecount += 1;
          i += 1;
          asterskip(i);
        }
      } else {
        charpos += 1;
      }
    }
  }
  if (charpos > stringmax) stringmax = charpos;

  return { text: mystring, linecount, stringmax, fc, fe };
}

// ---------------------------------------------------------------------------
// Passe 2 : layout (obj_writer Draw_0, texte entièrement révélé)
// Produit des opérations de dessin en coordonnées writer (writingx/writingy)
// ---------------------------------------------------------------------------
export function layoutText(formattedText, opts) {
  const {
    typer = 6,
    dark = false,
    fight = false,
    writingx = 0,
    writingy = 0,
    faceXShift = 0, // décalage writingx quand un visage est présent (58*f)
    initialFc = 0,
    initialFe = 0,
    hspaceScale = 1,
  } = opts;

  let cur = Object.assign({}, TYPERS[typer] || TYPERS[6]);
  cur.hspace *= hspaceScale;
  let mycolor = cur.color;
  let xcolor = mycolor;
  let colorchange = 0;
  let rainbow = 0;
  let fc = initialFc;
  let fe = initialFe;
  let drawaster = 1;

  const mystring = formattedText;
  const ops = [];
  const miniFaces = [];
  const warnings = [];
  let baseX = writingx + (fc !== 0 ? faceXShift : 0);
  let wx = baseX;
  let wy = writingy;
  let maxX = wx;
  let lineno = 0;

  const charAt = (i) => mystring.charAt(i - 1);
  const length = mystring.length;

  for (let n = 1; n <= length; n += 1) {
    let accept = 1;
    let mychar = charAt(n);
    if (mychar === "`") {
      n++;
      mychar = charAt(n);
    } else if (mychar === "&" || mychar === "\n") {
      accept = 0;
      wx = baseX;
      wy += cur.vspace;
      lineno++;
    } else if (mychar === "|") {
      accept = 0;
      wx += cur.hspace;
    } else if (mychar === "^") {
      accept = 0;
      n += 1;
    } else if (mychar === "/") {
      accept = 0;
    } else if (mychar === "%") {
      accept = 0;
    } else if (mychar === "\\") {
      const nextchar = charAt(n + 1);
      const nextchar2 = charAt(n + 2);
      if (nextchar === "E") {
        fe = decodeFe(nextchar2);
      } else if (nextchar === "F") {
        if (nextchar2 in F_TAG) {
          fc = F_TAG[nextchar2];
          baseX = writingx + (fc !== 0 ? faceXShift : 0);
          wx = baseX;
        } else {
          warnings.push(`\\F${nextchar2} : personnage inconnu`);
        }
      } else if (nextchar === "T") {
        const t = resolveTyper(nextchar2, { dark, fight });
        if (t != null && TYPERS[t]) {
          cur = Object.assign({}, TYPERS[t]);
          mycolor = cur.color;
          if (colorchange === 0) xcolor = mycolor;
        } else {
          warnings.push(`\\T${nextchar2} : style inconnu`);
        }
      } else if (nextchar === "c") {
        const c = C_TAG[nextchar2];
        if (c === "RAINBOW") {
          rainbow = 1;
          colorchange = 0;
        } else if (c === "RESET") {
          colorchange = 1;
          xcolor = mycolor;
          rainbow = 0;
        } else if (c) {
          colorchange = 1;
          xcolor = c;
          rainbow = 0;
        } else {
          warnings.push(`\\c${nextchar2} : couleur inconnue`);
        }
      } else if (nextchar === "m") {
        drawaster = 0;
        if (/\d/.test(nextchar2)) {
          // obj_writer Draw_0 : le mini-visage reste ancré au bord gauche du
          // writer, à (writingx - 8, ligne - 4), et est dessiné en x2.
          miniFaces.push({
            index: Number(nextchar2),
            x: writingx - 8,
            y: wy - 4,
            color: mycolor,
          });
        }
      } else if (nextchar === "C") {
        // obj_writer Draw_0 : \C1..\C4 créent obj_choicer (menu de choix)
        warnings.push(`\\C${nextchar2} : menu de choix du jeu (non simulé en preview)`);
      } else if (nextchar === "I") {
        // obj_writer Draw_0 : draw_sprite(global.writerimg[n], 0, wx, wy + 4)
        warnings.push(`\\I${nextchar2} : icône inline du jeu (non rendue en preview)`);
      } else if (nextchar === "O") {
        // obj_writer Draw_0 : instance_create(global.writerobj[n]) — objet animé
        warnings.push(`\\O${nextchar2} : objet animé du jeu (non rendu en preview)`);
      } else if (nextchar === "*") {
        // obj_writer Draw_0 : scr_getbuttonsprite — bouton manette/console
        warnings.push(`\\*${nextchar2} : bouton manette (non rendu en preview)`);
      } else if (
        !["s", "M", "v", "V", "S", "f", "z", "u", "d", "D", "x", "X", "H", "p", "P", "w", "W", "Y", "e", "b", "R", "t", "G", "g", "q", "_", "+", "-"].includes(
          nextchar
        )
      ) {
        warnings.push(`\\${nextchar}${nextchar2} : tag inconnu`);
      }
      accept = 0;
      n += 2;
    }
    if (accept === 1) {
      if (drawaster === 0 && mychar === "*") mychar = " ";
      if (mychar === "#") {
        // string_hash_to_newline : # agit comme un saut de ligne
        accept = 0;
        wx = baseX;
        wy += cur.vspace;
        lineno++;
        continue;
      }
      let color = mycolor;
      if (rainbow > 0) color = "RAINBOW:" + n;
      else if (colorchange === 1) color = xcolor;
      if (mychar !== " ") {
        ops.push({
          ch: mychar,
          x: wx,
          y: wy,
          color,
          font: cur.font,
          special: cur.special ?? 0,
        });
      }
      wx += cur.hspace;
      // ajustements spécifiques fnt_mainbig (myfont == 7 dans le GML)
      if (cur.font === "mainbig") {
        if (mychar === "w") wx += 2;
        if (mychar === "m") wx += 3;
        if (mychar === "i") wx -= 2;
        if (mychar === "l") wx -= 2;
        if (mychar === "s") wx -= 1;
        if (mychar === "j") wx -= 1;
      }
      if (wx > maxX) maxX = wx;
    }
  }

  return {
    ops,
    miniFaces,
    fc,
    fe,
    lines: lineno + 1,
    maxX,
    maxY: wy,
    hspace: cur.hspace,
    vspace: cur.vspace,
    font: cur.font,
    warnings: [...new Set(warnings)],
  };
}

// ---------------------------------------------------------------------------
// Analyse rapide d'un texte pour l'éditeur (tags + stats), sans layout
// ---------------------------------------------------------------------------
export function extractTags(text) {
  const tags = [];
  const re = /\\[A-Za-z*+\-_][^]?|\^[0-9]|~[0-9]+|[&%/|]|%%/g;
  let m;
  while ((m = re.exec(text))) {
    tags.push({ tag: m[0], index: m.index });
  }
  return tags;
}
