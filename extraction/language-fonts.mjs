import fs from "node:fs";
import path from "node:path";
import { makeFontsCsx } from "./import-lib.mjs";

export function makeDonorFontsCsx(directory) {
  return `using System.Linq;\nusing System.Text.Json;\n` + makeFontsCsx(directory) + `
var metadata = Data.Fonts.Select(font => new {
    Name = font.Name.Content, font.EmSize, font.Ascender, font.AscenderOffset, font.LineHeight,
    Glyphs = font.Glyphs.Select(g => new { g.Character, Kerning = g.Kerning.Select(k => new { k.Character, k.ShiftModifier }) })
});
File.WriteAllText(Path.Combine(${JSON.stringify(directory)}, "metadata.json"), JsonSerializer.Serialize(metadata));
ScriptMessage("DT_DONOR_FONTS");
`;
}

export function fontImportCsx(root) {
  return `
int donorFonts = 0;
foreach (string language in languages)
{
    string folder = Path.Combine(${JSON.stringify(root)}, language);
    if (!Directory.Exists(folder)) continue;
    int importedBefore = donorFonts;
    using var metadata = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, "metadata.json")));
    foreach (var original in fonts)
    {
        string baseName = original.Name.Content;
        string donorName = File.Exists(Path.Combine(folder, "fonts", "glyphs_" + baseName + "_" + language + ".csv")) ? baseName + "_" + language : baseName;
        string csv = Path.Combine(folder, "fonts", "glyphs_" + donorName + ".csv");
        if (!File.Exists(csv)) continue;
        string[] lines = File.ReadAllLines(csv);
        string[] header = lines[0].Split(';');
        float size = float.Parse(header[1], System.Globalization.CultureInfo.InvariantCulture);
        // Le donneur apporte les glyphes de la même famille ; un autre corps
        // modifierait la géométrie des boîtes et nécessite un réglage explicite.
        if (size != original.EmSize) { ScriptMessage("DT_FONT_SKIPPED " + language.ToUpperInvariant() + " — corps différent : " + baseName); continue; }
        var target = Data.Fonts.ByName(baseName + "_" + language);
        using MagickImage image = TextureWorker.ReadBGRAImageFromFile(Path.Combine(folder, "fonts", donorName + ".png"));
        var texture = new UndertaleEmbeddedTexture { Name = Data.Strings.MakeString("DT_FontTexture_" + Data.EmbeddedTextures.Count) };
        texture.TextureData.Image = GMImage.FromMagickImage(image).ConvertToPng();
        Data.EmbeddedTextures.Add(texture);
        var item = new UndertaleTexturePageItem { Name = Data.Strings.MakeString("DT_FontPage_" + Data.TexturePageItems.Count),
            SourceWidth = (ushort)image.Width, SourceHeight = (ushort)image.Height,
            TargetWidth = (ushort)image.Width, TargetHeight = (ushort)image.Height,
            BoundingWidth = (ushort)image.Width, BoundingHeight = (ushort)image.Height, TexturePage = texture };
        Data.TexturePageItems.Add(item);
        target.Texture = item;
        target.DisplayName = Data.Strings.MakeString(header[0]);
        target.Bold = bool.Parse(header[2]); target.Italic = bool.Parse(header[3]);
        target.Charset = byte.Parse(header[4]); target.AntiAliasing = byte.Parse(header[5]);
        target.ScaleX = float.Parse(header[6], System.Globalization.CultureInfo.InvariantCulture);
        target.ScaleY = float.Parse(header[7], System.Globalization.CultureInfo.InvariantCulture);
        var details = metadata.RootElement.EnumerateArray().First(f => f.GetProperty("Name").GetString() == donorName);
        foreach (string property in new[] { "Ascender", "AscenderOffset", "LineHeight" })
        {
            var p = typeof(UndertaleFont).GetProperty(property);
            p.SetValue(target, Convert.ChangeType(details.GetProperty(property).GetDouble(), p.PropertyType));
        }
        target.Glyphs.Clear();
        foreach (string line in lines.Skip(1).Where(l => !string.IsNullOrWhiteSpace(l)))
        {
            var v = line.Split(';');
            var glyph = new UndertaleFont.Glyph { Character = ushort.Parse(v[0]), SourceX = ushort.Parse(v[1]), SourceY = ushort.Parse(v[2]),
                SourceWidth = ushort.Parse(v[3]), SourceHeight = ushort.Parse(v[4]), Shift = short.Parse(v[5]), Offset = short.Parse(v[6]) };
            if (glyph.SourceX + glyph.SourceWidth > image.Width || glyph.SourceY + glyph.SourceHeight > image.Height) throw new Exception("Glyphe hors atlas : " + donorName);
            var metrics = details.GetProperty("Glyphs").EnumerateArray().First(g => g.GetProperty("Character").GetInt32() == glyph.Character);
            foreach (var k in metrics.GetProperty("Kerning").EnumerateArray()) glyph.Kerning.Add(new UndertaleFont.Glyph.GlyphKerning {
                Character = (short)k.GetProperty("Character").GetInt32(), ShiftModifier = (short)k.GetProperty("ShiftModifier").GetInt32() });
            target.Glyphs.Add(glyph);
        }
        target.RangeStart = target.Glyphs.Min(g => g.Character);
        target.RangeEnd = target.Glyphs.Max(g => g.Character);
        donorFonts++;
    }
    if (donorFonts == importedBefore) throw new Exception("Aucune police compatible dans le donneur de " + language);
}
ScriptMessage("DT_FONTS_IMPORTED " + donorFonts);
`;
}

export function donorFontFiles(workspace, language) {
  const root = path.join(workspace, "LanguageFonts", language);
  return { root, script: path.join(workspace, `font-donor-${language}.csx`) };
}

export function previewFontsCsx(workspace) {
  return makeFontsCsx(workspace).slice(makeFontsCsx(workspace).indexOf("string fontFolder"));
}
