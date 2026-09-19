// Les coordonnées TargetX/Y des pages sont non signées (UndertaleTexturePageItem).
// Source : https://github.com/UnderminersTeam/UndertaleModTool/blob/master/UndertaleModLib/Models/UndertaleTexturePageItem.cs
// Une marge commune et l'origine compensée permettent des décalages négatifs sans rogner les frames.
int ImportSpriteFrames(UndertaleSprite sprite, string directory)
{
    var replacements = new System.Collections.Generic.Dictionary<int, (string File, int X, int Y, int W, int H)>();
    int oldWidth = (int)sprite.Width, oldHeight = (int)sprite.Height;
    int left = 0, top = 0, right = oldWidth, bottom = oldHeight;
    foreach (string file in Directory.GetFiles(directory, "*.png"))
    {
        if (!int.TryParse(Path.GetFileNameWithoutExtension(file), out int frame) || frame < 0 || frame >= sprite.Textures.Count)
            throw new Exception("Frame invalide : " + file);
        int x = 0, y = 0;
        string offsetFile = Path.Combine(directory, frame + ".offset");
        if (File.Exists(offsetFile))
        {
            string[] values = File.ReadAllText(offsetFile).Trim().Split(';');
            if (values.Length != 2 || !int.TryParse(values[0], out x) || !int.TryParse(values[1], out y) || Math.Abs((long)x) > 8192 || Math.Abs((long)y) > 8192)
                throw new Exception("Position invalide : " + offsetFile);
        }
        using MagickImage image = TextureWorker.ReadBGRAImageFromFile(file);
        int w = checked((int)image.Width), h = checked((int)image.Height);
        if (w < 1 || h < 1 || w > 8192 || h > 8192) throw new Exception("Dimensions invalides : " + file);
        replacements.Add(frame, (file, x, y, w, h));
        left = Math.Min(left, x); top = Math.Min(top, y);
        right = Math.Max(right, x + w); bottom = Math.Max(bottom, y + h);
    }
    if (replacements.Count == 0) return 0;
    int width = right - left, height = bottom - top;
    if (width > 8192 || height > 8192 || (long)width * height > 16777216)
        throw new Exception("Le sprite positionné dépasse les dimensions autorisées : " + sprite.Name.Content);
    bool resized = width != oldWidth || height != oldHeight || left != 0 || top != 0;
    if (resized && (sprite.SSpriteType != UndertaleSprite.SpriteType.Normal || sprite.V3NineSlice?.Enabled == true))
        throw new Exception("Le redimensionnement des sprites spéciaux ou à neuf tranches n’est pas pris en charge : " + sprite.Name.Content);

    for (int frame = 0; frame < sprite.Textures.Count; frame++)
    {
        var previous = sprite.Textures[frame]?.Texture;
        if (!replacements.TryGetValue(frame, out var replacement) && (!resized || previous == null)) continue;
        var item = new UndertaleTexturePageItem { Name = Data.Strings.MakeString("DT_Page_" + Data.TexturePageItems.Count),
            BoundingWidth = (ushort)width, BoundingHeight = (ushort)height };
        if (replacements.ContainsKey(frame))
        {
            using MagickImage image = TextureWorker.ReadBGRAImageFromFile(replacement.File);
            var texture = new UndertaleEmbeddedTexture { Name = Data.Strings.MakeString("DT_Texture_" + Data.EmbeddedTextures.Count) };
            texture.TextureData.Image = GMImage.FromMagickImage(image).ConvertToPng();
            Data.EmbeddedTextures.Add(texture);
            item.SourceWidth = item.TargetWidth = (ushort)replacement.W;
            item.SourceHeight = item.TargetHeight = (ushort)replacement.H;
            item.TargetX = (ushort)(replacement.X - left); item.TargetY = (ushort)(replacement.Y - top);
            item.TexturePage = texture;
        }
        else
        {
            // Les pages peuvent être partagées avec l'anglais ou d'autres sprites : toujours les cloner.
            item.SourceX = previous.SourceX; item.SourceY = previous.SourceY;
            item.SourceWidth = previous.SourceWidth; item.SourceHeight = previous.SourceHeight;
            item.TargetWidth = previous.TargetWidth; item.TargetHeight = previous.TargetHeight;
            item.TargetX = checked((ushort)(previous.TargetX - left)); item.TargetY = checked((ushort)(previous.TargetY - top));
            item.TexturePage = previous.TexturePage;
        }
        Data.TexturePageItems.Add(item);
        sprite.Textures[frame] = new UndertaleSprite.TextureEntry { Texture = item };
    }
    if (resized)
    {
        // UndertaleSprite.CalculateMaskDimensions : depuis GM 2024.6 les masques sont relatifs à la bbox.
        // https://github.com/UnderminersTeam/UndertaleModTool/blob/master/UndertaleModLib/Models/UndertaleSprite.cs
        if (!Data.IsVersionAtLeast(2024, 6))
        {
            for (int i = 0; i < sprite.CollisionMasks.Count; i++)
            {
                var old = sprite.CollisionMasks[i];
                byte[] pixels = new byte[((width + 7) / 8) * height];
                int oldStride = (oldWidth + 7) / 8, stride = (width + 7) / 8;
                for (int y = 0; y < oldHeight; y++)
                    for (int x = 0; x < oldWidth; x++)
                        if ((old.Data[y * oldStride + x / 8] & (1 << (7 - x % 8))) != 0)
                            pixels[(y - top) * stride + (x - left) / 8] |= (byte)(1 << (7 - (x - left) % 8));
                sprite.CollisionMasks[i] = new UndertaleSprite.MaskEntry(pixels, width, height);
            }
        }
        sprite.Width = (uint)width; sprite.Height = (uint)height;
        sprite.OriginXWrapper -= left; sprite.OriginYWrapper -= top;
        sprite.MarginLeft -= left; sprite.MarginRight -= left;
        sprite.MarginTop -= top; sprite.MarginBottom -= top;
    }
    return replacements.Count;
}
