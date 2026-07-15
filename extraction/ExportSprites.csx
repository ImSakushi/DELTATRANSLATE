// Exporte les sprites utiles à la preview du TranslatorTool
using System.Text;
using System;
using System.IO;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();

string outRoot = @"C:\Users\Pablo\Desktop\TranslatorTool\extracted\sprites";
Directory.CreateDirectory(outRoot);

string[] prefixes = new string[] {
    "spr_face_", "spr_textbox_", "spr_pxwhite", "spr_battleblcon", "spr_blcon",
    "button_", "spr_smallface", "spr_darkface"
};

int exported = 0;
using (TextureWorker worker = new())
{
    foreach (var spr in Data.Sprites)
    {
        if (spr is null) continue;
        string name = spr.Name.Content;
        if (!prefixes.Any(p => name.StartsWith(p))) continue;
        for (int i = 0; i < spr.Textures.Count; i++)
        {
            if (spr.Textures[i]?.Texture is null) continue;
            try
            {
                worker.ExportAsPNG(spr.Textures[i].Texture, Path.Combine(outRoot, $"{name}_{i}.png"), null, true); // padded = vraie taille du sprite
                exported++;
            }
            catch (Exception e)
            {
                ScriptMessage($"ERREUR {name}_{i}: {e.Message}");
            }
        }
    }
}
ScriptMessage($"Sprites exportés: {exported}");
