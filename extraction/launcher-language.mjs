import fs from "node:fs";
import path from "node:path";
import { normalizeLanguage, installedLanguages } from "./languages.mjs";

export function launcherPaths(dataWin) {
  const chapter = path.dirname(path.resolve(dataWin));
  if (!/^chapter\d+_(?:windows|mac|linux)$/i.test(path.basename(chapter))) return null;
  const root = path.dirname(chapter);
  const target = path.join(root, "data.win");
  return fs.existsSync(target) ? { root, target } : null;
}

export function launcherLanguages(root, language) {
  return [...new Set([normalizeLanguage(language), ...fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chapter\d+_/.test(entry.name))
    .flatMap((entry) => installedLanguages(path.join(root, entry.name, "lang")))])].sort();
}

export function prepareLauncherGml(codeDir, outputDir, languages) {
  const codes = ["en", ...languages.map(normalizeLanguage), "ja"];
  const mainFile = "gml_Object_obj_CHAPTER_SELECT_Create_0.gml";
  const footerFile = "gml_Object_obj_screen_select_footer_Create_0.gml";
  const read = (name) => fs.readFileSync(path.join(codeDir, name), "utf8").replaceAll("\r\n", "\n");
  const main = read(mainFile);
  const oldMenu = main.includes("open_text_language_settings = function");
  fs.mkdirSync(outputDir, { recursive: true });
  let changed = 0;
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const original = read(file);
    // Dans le lanceur, ces tests choisissent tous une chaîne ou une disposition EN/JA.
    // L’affectation du prochain code de langue et sa fonte sont traitées à part.
    let source = original.replaceAll('global.lang == "en"', 'global.lang != "ja"');
    if (file === mainFile) {
      if (oldMenu) {
        const choices = codes.map((code, i) => `new create_choice(${JSON.stringify(code === "en" ? "English" : code === "ja" ? "日本語" : code.toUpperCase())}, ${100 + i})`);
        const menu = /open_text_language_settings = function\(\)\s*\{[\s\S]*?\n\};/;
        const block = source.match(menu)?.[0];
        if (!block || !block.includes("var choices =")) throw new Error("Sous-menu de langue du mod non reconnu.");
        source = source.replace(menu, block.replace(/var choices = \[[^;]+;/,
          `var choices = [${choices.join(", ")}, new create_choice("Back", 999)];`));
        source = source.replace(/event_value >= 100 && event_value <= \d+/, `event_value >= 100 && event_value < ${100 + codes.length}`)
          .replace(/var selected_lang = [^;]+;/, `var selected_lang = dt_launcher_codes()[event_value - 100];`)
          .replace(/event_value == 103/g, "event_value == 999");
      } else {
        const pattern = /var target_lang = [^;]+;/;
        if (!pattern.test(source)) throw new Error("Sélecteur de langue du lanceur non reconnu.");
        source = source.replace(pattern, "var target_lang = dt_launcher_next();");
      }
      // Un chapitre qui n’a pas encore de fichier pour cette langue démarre en EN.
      const anchor = "var chapstring = string(_target_chapter);";
      if (!source.includes(anchor)) throw new Error("Démarrage des chapitres non reconnu.");
      if (!source.includes("dt_launcher_prepare_chapter")) source = source.replace(anchor, `${anchor}\n    dt_launcher_prepare_chapter(chapstring);`);
    }
    if (file === footerFile && !oldMenu) {
      source = source.replace(/var language_text = [^;]+;/, "var language_text = dt_launcher_label(dt_launcher_next());")
        .replace(/if \(global.lang != "ja"\)(\s*\{\s*language_choice.set_font\(1\);)/, 'if (dt_launcher_next() == "ja")$1');
    }
    if (file === "gml_GlobalScript_scr_init.gml") {
      source = source.replace(/\nfunction dt_launcher_codes\(\)[\s\S]*$/, "");
      source += `
function dt_launcher_codes() { return ${JSON.stringify(codes)}; }
function dt_launcher_label(code)
{
    if (code == "en") return "English";
    if (code == "ja") return "日本語";
    return string_upper(string_replace_all(code, "_", "-"));
}
function dt_launcher_next()
{
    var choices = dt_launcher_codes();
    for (var i = 0; i < array_length(choices); i++)
        if (choices[i] == global.lang) return choices[(i + 1) mod array_length(choices)];
    return "en";
}
function dt_launcher_prepare_chapter(chapter)
{
    if (global.lang == "en" || global.lang == "ja") return;
    var suffix = (os_type == os_macosx) ? "_mac" : "_windows";
    if (!file_exists(working_directory + "chapter" + chapter + suffix + "/lang/lang_" + global.lang + ".json"))
    {
        global.lang = "en";
        ossafe_ini_open("true_config.ini");
        ini_write_string("LANG", "LANG", global.lang);
        ossafe_ini_close();
        ossafe_savedata_save();
    }
}
`;
    }
    if (source !== original) { fs.writeFileSync(path.join(outputDir, file), source); changed++; }
  }
  return changed;
}
