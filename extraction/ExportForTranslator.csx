// Extraction non-interactive pour TranslatorTool
// - Décompile tout le code GML
// - Exporte les fonts (PNG + glyphes CSV)
// - Liste tous les sprites (nom;frames;largeur;hauteur)
using System.Text;
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();

string outRoot = @"C:\Users\Pablo\Desktop\TranslatorTool\extracted";
string codeFolder = Path.Combine(outRoot, "code");
string fontFolder = Path.Combine(outRoot, "fonts");
Directory.CreateDirectory(codeFolder);
Directory.CreateDirectory(fontFolder);

// --- Liste des sprites ---
using (StreamWriter sw = new(Path.Combine(outRoot, "sprites_list.txt")))
{
    foreach (var spr in Data.Sprites)
    {
        if (spr is null) continue;
        sw.WriteLine($"{spr.Name.Content};{spr.Textures.Count};{spr.Width};{spr.Height}");
    }
}
ScriptMessage("Liste des sprites exportée.");

// --- Fonts ---
using (TextureWorker worker = new())
{
    foreach (var font in Data.Fonts)
    {
        if (font is null) continue;
        worker.ExportAsPNG(font.Texture, Path.Combine(fontFolder, $"{font.Name.Content}.png"));
        using (StreamWriter writer = new(Path.Combine(fontFolder, $"glyphs_{font.Name.Content}.csv")))
        {
            writer.WriteLine($"{font.DisplayName};{font.EmSize};{font.Bold};{font.Italic};{font.Charset};{font.AntiAliasing};{font.ScaleX};{font.ScaleY}");
            foreach (var g in font.Glyphs)
            {
                writer.WriteLine($"{g.Character};{g.SourceX};{g.SourceY};{g.SourceWidth};{g.SourceHeight};{g.Shift};{g.Offset}");
            }
        }
    }
}
ScriptMessage("Fonts exportées.");

// --- Code GML décompilé ---
GlobalDecompileContext globalDecompileContext = new(Data);
Underanalyzer.Decompiler.IDecompileSettings decompilerSettings = Data.ToolInfo.DecompilerSettings;
List<UndertaleCode> toDump = Data.Code.Where(c => c.ParentEntry is null).ToList();
ScriptMessage($"Décompilation de {toDump.Count} entrées de code...");

int done = 0;
Parallel.ForEach(toDump, code =>
{
    if (code is not null)
    {
        string path = Path.Combine(codeFolder, code.Name.Content + ".gml");
        try
        {
            File.WriteAllText(path, new Underanalyzer.Decompiler.DecompileContext(globalDecompileContext, code, decompilerSettings).DecompileToString());
        }
        catch (Exception e)
        {
            File.WriteAllText(path, "/*\nDECOMPILER FAILED!\n\n" + e.ToString() + "\n*/");
        }
    }
    int d = Interlocked.Increment(ref done);
    if (d % 500 == 0) ScriptMessage($"  {d}/{toDump.Count}");
});

ScriptMessage("Code décompilé. Extraction terminée.");
