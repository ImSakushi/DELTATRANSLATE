import fs from "node:fs";
import path from "node:path";
import { normalizeLanguage } from "./languages.mjs";

export const MULTILANG_VERSION = "DELTATRANSLATE_MULTILANG_V1";

// Contextes latins vérifiés dans le mod EN/FR/JA (repair-fr-ja-routing et
// apply-refresh) : ne pas appliquer cette règle à is_english ni au chargement JSON.
const LATIN_ENTRIES = new Set([
  "scr_gamestart", "scr_debug_load", "scr_load", "scr_get_input_name",
  "obj_credits_Step_0", "obj_credits_2_Step_0", "obj_darkcontroller_Draw_0",
  "obj_splashscreen_Create_0", "obj_splashscreen_Draw_0", "obj_splashscreen_Step_0",
  "obj_writer_Draw_0", "obj_custommenu_Draw_0", "obj_fusionmenu_Draw_0",
  "obj_ch2_scene8_Draw_0", "obj_ch2_sceneex2_special_Draw_0",
  "obj_npc_mansion_room_Create_0", "obj_rouxls_simtown_Draw_0", "obj_savemenu_Draw_0",
  "obj_ch3_GSA02_Step_0", "obj_ch3_PGS01A_Step_0", "obj_quiz_podium_Draw_0",
  "obj_writer_quiz_Other_10", "obj_dw_church_intro_guei_Draw_0",
  "obj_dw_church_prophecy_Draw_0", "obj_titan_enemy_Step_0",
  "obj_screen_loading_Create_0", "obj_chapter_continue_Create_0",
  "obj_darkcontroller_Create_0", "scr_roomname",
]);

// Masquer les chaînes/commentaires garde les positions sans réécrire leur contenu.
export function maskGml(source) {
  return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (part) => part.replace(/[^\r\n]/g, " "));
}

export function routeDrawCalls(source) {
  const masked = maskGml(source);
  const edits = [];
  // scr_draw_sprite_pos_fixed et scr_retro_pal_swapper utilisent aussi les UV et la texture.
  const pattern = /\b(draw_sprite(?:_[a-z0-9_]+)?|sprite_get_texture|sprite_get_uvs|draw_set_font|layer_sprite_create|layer_sprite_change|layer_background_sprite|layer_background_create)\s*\(/g;
  for (const match of masked.matchAll(pattern)) {
    if (/\bfunction\s+$/.test(masked.slice(0, match.index))) continue;
    const start = match.index + match[0].length;
    const argument = match[1] === "layer_sprite_create" ? 3 :
      /^(layer_sprite_change|layer_background_sprite|layer_background_create)$/.test(match[1]) ? 1 : 0;
    let depth = 0, index = start, argStart = start, current = 0;
    for (; index < masked.length; index++) {
      const char = masked[index];
      if ("([{".includes(char)) depth++;
      if (")]}".includes(char)) {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && char === ",") {
        if (current === argument) break;
        current++;
        argStart = index + 1;
      }
    }
    if (current !== argument || !source.slice(argStart, index).trim()) continue;
    const helper = match[1] === "draw_set_font" ? "dt_font" : "dt_sprite";
    if (source.slice(argStart, index).trim().startsWith(`${helper}(`)) continue;
    edits.push({ pos: argStart, text: `${helper}(` }, { pos: index, text: ")" });
  }
  for (const edit of edits.sort((a, b) => b.pos - a.pos)) {
    source = source.slice(0, edit.pos) + edit.text + source.slice(edit.pos);
  }
  const selfCalls = [...maskGml(source).matchAll(/\bdraw_self\s*\(\s*\)/g)];
  for (const call of selfCalls.reverse()) source = source.slice(0, call.index) + "dt_draw_self()" + source.slice(call.index + call[0].length);
  return source;
}

export function runtimeGml(languages) {
  const codes = ["en", ...[...new Set(languages.map(normalizeLanguage))].sort(), "ja"];
  return `
function dt_languages()
{
    return ${JSON.stringify(codes)};
}

function dt_next_language()
{
    var choices = dt_languages();
    var current = 0;
    for (var i = 0; i < array_length_1d(choices); i++)
        if (choices[i] == global.lang) current = i;
    for (var i = 1; i <= array_length_1d(choices); i++)
    {
        var code = choices[(current + i) mod array_length_1d(choices)];
        if (code == "en" || code == "ja" || file_exists(working_directory + "lang/lang_" + code + ".json")) return code;
    }
    return "en";
}

function dt_language_label(code)
{
    if (code == "en") return "English";
    if (code == "ja") return "日本語";
    return string_upper(string_replace_all(code, "_", "-"));
}

function dt_resource(original, kind)
{
    if (!variable_global_exists("lang") || original < 0) return original;
    if (!variable_global_exists("dt_resource_cache")) global.dt_resource_cache = ds_map_create();
    var key = global.lang + ":" + string(kind) + ":" + string(original);
    if (ds_map_exists(global.dt_resource_cache, key)) return ds_map_find_value(global.dt_resource_cache, key);
    var name = (kind == 0) ? sprite_get_name(original) : font_get_name(original);
    var base = original;
    var choices = dt_languages();
    for (var i = 1; i < array_length_1d(choices) - 1; i++)
    {
        var suffix = "_" + choices[i];
        var length = string_length(name) - string_length(suffix);
        if (length > 0 && string_copy(name, length + 1, string_length(suffix)) == suffix)
        {
            var candidate = asset_get_index(string_copy(name, 1, length));
            if (candidate >= 0) { base = candidate; name = string_copy(name, 1, length); break; }
        }
    }
    var result = base;
    if (global.lang != "en" && global.lang != "ja")
    {
        var candidate = asset_get_index(name + "_" + global.lang);
        if (candidate >= 0) result = candidate;
    }
    ds_map_add(global.dt_resource_cache, key, result);
    return result;
}

function dt_sprite(original) { return dt_resource(original, 0); }
function dt_font(original) { return dt_resource(original, 1); }

function dt_draw_self()
{
    draw_sprite_ext(dt_sprite(sprite_index), image_index, x, y, image_xscale, image_yscale, image_angle, image_blend, image_alpha);
}

function dt_refresh_sprites()
{
    var layers = layer_get_all();
    for (var i = 0; i < array_length_1d(layers); i++)
    {
        var elements = layer_get_all_elements(layers[i]);
        for (var j = 0; j < array_length_1d(elements); j++)
        {
            var element = elements[j];
            var kind = layer_get_element_type(element);
            if (kind == 4) layer_sprite_change(element, dt_sprite(layer_sprite_get_sprite(element)));
            if (kind == 1) layer_background_sprite(element, dt_sprite(layer_background_get_sprite(element)));
        }
    }
}
`;
}

export function prepareMultilangGml({ codeDir, outputDir, languages, overridesDir }) {
  const read = (name) => {
    const file = path.join(codeDir, `${name}.gml`);
    if (!fs.existsSync(file)) throw new Error(`Version du jeu non reconnue : ${name} absent.`);
    return fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  };
  const change = read("gml_GlobalScript_scr_change_language");
  const init = read("gml_GlobalScript_scr_84_init_localization");
  read("gml_GlobalScript_scr_84_lang_load");
  const already = change.includes(MULTILANG_VERSION);
  const protectedNames = new Set(["gml_GlobalScript_scr_change_language.gml", "gml_GlobalScript_scr_84_init_localization.gml"]);
  fs.mkdirSync(outputDir, { recursive: true });
  const changed = [];
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const override = overridesDir && path.join(overridesDir, file);
    if (override && fs.existsSync(override) && protectedNames.has(file)) {
      throw new Error(`Le code personnalisé ${file} entre en conflit avec l’installation des langues.`);
    }
    const original = read(file.slice(0, -4));
    let source = override && fs.existsSync(override) ? fs.readFileSync(override, "utf8") : original;
    const shortName = file.replace(/^gml_(?:GlobalScript|Object)_/, "").replace(/\.gml$/, "");
    if (LATIN_ENTRIES.has(shortName)) source = source.replaceAll('global.lang == "en"', 'global.lang != "ja"');
    if (file === "gml_GlobalScript_scr_change_language.gml") {
      // scr_change_language vanilla : même persistance INI et même réinitialisation.
      source = `function scr_change_language()\n{\n    var signature = "${MULTILANG_VERSION}";\n    global.lang = dt_next_language();\n    ossafe_ini_open("true_config.ini");\n    ini_write_string("LANG", "LANG", global.lang);\n    ossafe_ini_close();\n    ossafe_savedata_save();\n    scr_84_init_localization();\n    dt_refresh_sprites();\n}\n` + runtimeGml(languages);
    } else {
      if (file === "gml_GlobalScript_scr_84_init_localization.gml") {
        const anchor = "if (global.lang_loaded != global.lang)";
        if (!source.includes(anchor)) throw new Error("Initialisation des langues non reconnue.");
        if (!already) source = source.replace(anchor,
          `if (global.lang != "en" && global.lang != "ja" && !file_exists(working_directory + "lang/lang_" + global.lang + ".json")) global.lang = "en";\n    ${anchor}`);
        if (!source.includes("instance_exists(obj_dt_languages)")) {
          const end = source.lastIndexOf("}");
          source = source.slice(0, end) + "    if (!instance_exists(obj_dt_languages)) instance_create(0, 0, obj_dt_languages);\n" + source.slice(end);
        }
      }
      if (file === "gml_Object_DEVICE_MENU_Draw_0.gml") {
        const label = /LANGUAGETEXT = \(global\.lang == "en"\) \? stringset\("日本語"\) : stringset\("English"\);/;
        // Le mod RUNEDELTA a trois affectations successives ; le libellé final prévaut.
        if (source.includes("LANGUAGETEXT") && !source.includes("dt_language_label")) {
          if (label.test(source)) source = source.replace(label, 'LANGUAGETEXT = stringset(dt_language_label(dt_next_language()));');
          else source = source.replace(/(var (?:languagex|lang_offset)\s*=)/, 'LANGUAGETEXT = dt_language_label(dt_next_language());\n        $1');
          source = source.replace(/if \(global.lang == "(?:en|fr)"\)(\s*\{\s*draw_set_font\(fnt_ja_main\);)/,
            'if (dt_next_language() == "ja")$1');
          source = source.replace(/if \(global.lang == "(?:en|fr)"\)(\s*\{\s*lang_offset -= 2;\s*draw_set_font\(fnt_ja_main\);)/,
            'if (dt_next_language() == "ja")$1');
          if (!source.includes("dt_language_label")) throw new Error("Menu de langue non reconnu.");
        }
        source = source.replace(/if \(global.lang == "en"\)(\s*\{\s*if \(scr_kana_check)/g, 'if (global.lang != "ja")$1');
      }
      if (file === "gml_Object_lang_sprite_layer_hider_Create_0.gml") {
        source = source.replaceAll('__lang != global.lang', '__lang != ((global.lang == "ja") ? "ja" : "en")');
      }
      source = routeDrawCalls(source);
    }
    if (source !== original) {
      fs.writeFileSync(path.join(outputDir, file), source);
      changed.push(file);
    }
  }
  if (!init.includes("global.lang") || !change.includes("ini_write_string")) throw new Error("Moteur de langue non reconnu.");
  return changed;
}
