// Généré/invoqué par import-datawin.mjs. Le fichier ne contient aucune donnée
// du jeu : les rooms et textures sont lues dynamiquement depuis le data.win.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using ImageMagick;
using Newtonsoft.Json.Linq;
using UndertaleModLib.Models;
using UndertaleModLib.Util;

EnsureDataLoaded();

string outRoot = "__OUT_ROOT__";
string sceneFolder = Path.Combine(outRoot, "room-scenes");
Directory.CreateDirectory(sceneFolder);
string[] requestedObjects = new string[] { __REQUESTED_OBJECTS__ };
string[] requestedRooms = new string[] { __REQUESTED_ROOMS__ };
string[] requestedCameraViews = new string[] { __REQUESTED_CAMERA_VIEWS__ };
JObject root = new JObject();
JObject objectResults = new JObject();
JObject roomResults = new JObject();
JObject sceneResults = new JObject();
JObject cameraResults = new JObject();
root["version"] = 4;
root["objects"] = objectResults;
root["rooms"] = roomResults;
root["scenes"] = sceneResults;
root["cameraViews"] = cameraResults;

MagickColor GMColor(uint color)
{
    byte a = (byte)(color >> 24);
    byte r = (byte)(color & 255);
    byte g = (byte)((color >> 8) & 255);
    byte b = (byte)((color >> 16) & 255);
    return new MagickColor(r, g, b, a);
}

bool MatchesObject(UndertaleGameObject instanceObject, string requested, out bool direct)
{
    direct = false;
    for (UndertaleGameObject current = instanceObject; current != null; current = current.ParentId)
    {
        if (current.Name?.Content != requested) continue;
        direct = current == instanceObject;
        return true;
    }
    return false;
}

string SafeName(string value)
{
    foreach (char invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
    return value;
}

TextureWorker worker = new TextureWorker();
Dictionary<UndertaleTexturePageItem, IMagickImage<byte>> textureCache =
    new Dictionary<UndertaleTexturePageItem, IMagickImage<byte>>();
Dictionary<string, IMagickImage<byte>> tileCache = new Dictionary<string, IMagickImage<byte>>();

// Les caches créés par une ancienne version ne contiennent pas forcément les
// ressources des modes plateformer et procès. L'export de rooms les remet à
// niveau sans imposer une décompilation complète du chapitre.
string spriteFolder = Path.Combine(outRoot, "sprites");
Directory.CreateDirectory(spriteFolder);
foreach (string name in new[] {
    "spr_gradient_triangle_dialoguer_plat", "spr_gradient20",
    "spr_trial_podium", "spr_kris_lawyer", "spr_kris_lawyer_alt",
    "spr_susie_lawyer", "spr_ralsei_lawyer", "spr_trial_spotlight",
    "spr_aqua_walk_down", "spr_seth_walk_down", "spr_enemy_green_walk",
    "spr_yellow_walk_down", "spr_blue_poses", "spr_heart_centered",
    "spr_sneo_bullet_arrow", "spr_empty",
    "spr_dw_fcastle_top_ascent_susieface",
    "spr_dw_fcastle_top_ascent_ralseiface"
})
{
    var sprite = Data.Sprites.ByName(name);
    if (sprite == null) continue;
    for (int frame = 0; frame < sprite.Textures.Count; frame++)
    {
        if (sprite.Textures[frame]?.Texture == null) continue;
        worker.ExportAsPNG(
            sprite.Textures[frame].Texture,
            Path.Combine(spriteFolder, name + "_" + frame + ".png"), null, true);
    }
}

void ClearImageCaches()
{
    foreach (var image in textureCache.Values) image.Dispose();
    foreach (var image in tileCache.Values) image.Dispose();
    textureCache.Clear();
    tileCache.Clear();
}

IMagickImage<byte> BaseTexture(UndertaleTexturePageItem texture)
{
    if (texture == null) return null;
    if (!textureCache.ContainsKey(texture)) textureCache[texture] = worker.GetTextureFor(texture, null, true);
    return textureCache[texture];
}

IMagickImage<byte> TileTexture(UndertaleBackground background, uint id)
{
    string key = background.Name.Content + ":" + id;
    if (tileCache.ContainsKey(key)) return tileCache[key];
    IMagickImage<byte> page = BaseTexture(background.Texture);
    if (page == null) return null;
    int width = (int)background.GMS2TileWidth;
    int height = (int)background.GMS2TileHeight;
    int columns = (int)background.GMS2TileColumns;
    int column = (int)(id % columns);
    int row = (int)(id / columns);
    int x = (column + 1) * (int)background.GMS2OutputBorderX +
            column * (width + (int)background.GMS2OutputBorderX);
    int y = (row + 1) * (int)background.GMS2OutputBorderY +
            row * (height + (int)background.GMS2OutputBorderY);
    IMagickImage<byte> tile = page.Clone();
    tile.Crop(new MagickGeometry(x, y, (uint)width, (uint)height));
    tileCache[key] = tile;
    return tile;
}

void DrawTexture(MagickImage canvas, UndertaleTexturePageItem texture, int x, int y,
                 int cameraX, int cameraY, double scaleX, double scaleY,
                 double rotation, byte alpha)
{
    IMagickImage<byte> source = BaseTexture(texture);
    if (source == null) return;
    IMagickImage<byte> image = source.Clone();
    image.FilterType = FilterType.Point;
    if (scaleX < 0) image.Flop();
    if (scaleY < 0) image.Flip();
    uint width = (uint)Math.Max(1, (int)Math.Round(image.Width * Math.Abs(scaleX)));
    uint height = (uint)Math.Max(1, (int)Math.Round(image.Height * Math.Abs(scaleY)));
    if (width != image.Width || height != image.Height) image.Resize(width, height);
    if (rotation != 0) image.Rotate(rotation);
    if (alpha != 255) image.Evaluate(Channels.Alpha, EvaluateOperator.Multiply, alpha / 255.0);
    canvas.Composite(image, x - cameraX, y - cameraY, CompositeOperator.Over);
    image.Dispose();
}

void DrawTileLayer(MagickImage canvas, UndertaleRoom.Layer layer, int cameraX, int cameraY)
{
    var data = layer.TilesData;
    var background = data?.Background;
    if (background?.Texture == null || background.GMS2TileColumns == 0) return;
    int width = (int)background.GMS2TileWidth;
    int height = (int)background.GMS2TileHeight;
    int firstX = Math.Max(0, (cameraX - (int)layer.XOffset) / width - 1);
    int firstY = Math.Max(0, (cameraY - (int)layer.YOffset) / height - 1);
    int lastX = Math.Min((int)data.TilesX - 1, (cameraX + 640 - (int)layer.XOffset) / width + 1);
    int lastY = Math.Min((int)data.TilesY - 1, (cameraY + 480 - (int)layer.YOffset) / height + 1);
    uint maxId = background.GMS2TileIds.Count > 0
        ? background.GMS2TileIds.Max(item => item.ID)
        : Math.Max(0, background.GMS2TileCount - 1);
    for (int y = firstY; y <= lastY; y++)
    for (int x = firstX; x <= lastX; x++)
    {
        uint encoded = data.TileData[y][x];
        if (encoded == 0) continue;
        uint id = encoded & 0x0FFFFFFF;
        if (id > maxId) continue;
        IMagickImage<byte> source = TileTexture(background, id);
        if (source == null) continue;
        IMagickImage<byte> tile = source.Clone();
        switch (encoded >> 28)
        {
            case 1: tile.Flop(); break;
            case 2: tile.Flip(); break;
            case 3: tile.Flop(); tile.Flip(); break;
            case 4: tile.Rotate(90); break;
            case 5: tile.Flop(); tile.Rotate(90); break;
            case 6: tile.Flip(); tile.Rotate(90); break;
            case 7: tile.Flop(); tile.Flip(); tile.Rotate(90); break;
        }
        canvas.Composite(tile,
            (int)layer.XOffset + x * width - cameraX,
            (int)layer.YOffset + y * height - cameraY,
            CompositeOperator.Over);
        tile.Dispose();
    }
}

void DrawBackgroundLayer(MagickImage canvas, UndertaleRoom room, UndertaleRoom.Layer layer,
                         int cameraX, int cameraY)
{
    var data = layer.BackgroundData;
    var sprite = data?.Sprite;
    var texture = sprite?.Textures.FirstOrDefault()?.Texture;
    if (texture == null || !data.Visible) return;
    IMagickImage<byte> source = BaseTexture(texture);
    if (source == null) return;
    double scaleX = data.Stretch ? room.Width / (double)Math.Max(1, sprite.Width) : 1;
    double scaleY = data.Stretch ? room.Height / (double)Math.Max(1, sprite.Height) : 1;
    int baseX = (int)layer.XOffset - sprite.OriginXWrapper;
    int baseY = (int)layer.YOffset - sprite.OriginYWrapper;
    int stepX = Math.Max(1, (int)Math.Round(source.Width * scaleX));
    int stepY = Math.Max(1, (int)Math.Round(source.Height * scaleY));
    int startX = data.TiledHorizontally ? cameraX - ((cameraX - baseX) % stepX + stepX) % stepX : baseX;
    int startY = data.TiledVertically ? cameraY - ((cameraY - baseY) % stepY + stepY) % stepY : baseY;
    int endX = data.TiledHorizontally ? cameraX + 640 : startX;
    int endY = data.TiledVertically ? cameraY + 480 : startY;
    for (int y = startY; y <= endY; y += stepY)
    for (int x = startX; x <= endX; x += stepX)
        DrawTexture(canvas, texture, x, y, cameraX, cameraY, scaleX, scaleY, 0, (byte)(data.Color >> 24));
}

bool IsEditorOnlyInstance(UndertaleRoom.GameObject item)
{
    string objectName = item.ObjectDefinition?.Name?.Content ?? "";
    string spriteName = item.ObjectDefinition?.Sprite?.Name?.Content ?? "";
    if (spriteName.IndexOf("debug", StringComparison.OrdinalIgnoreCase) >= 0) return true;
    if (spriteName.StartsWith("spr_dbg", StringComparison.OrdinalIgnoreCase)) return true;
    if (spriteName == "spr_plat_grid" || spriteName == "spr_plat_thinplat") return true;
    return objectName == "obj_plat_cam_clampzone" ||
           objectName == "obj_plat_attacktrigger" ||
           objectName == "obj_plat_text_at_bottom_zone" ||
           objectName == "obj_plat_sequence_marker";
}

bool PointInsideObject(UndertaleRoom room, int x, int y, string requested)
{
    foreach (var item in room.GameObjects)
    {
        bool direct;
        if (!MatchesObject(item.ObjectDefinition, requested, out direct)) continue;
        var sprite = item.ObjectDefinition?.Sprite;
        if (sprite == null) continue;
        double x0 = item.X - sprite.OriginXWrapper * item.ScaleX;
        double y0 = item.Y - sprite.OriginYWrapper * item.ScaleY;
        double x1 = x0 + sprite.Width * item.ScaleX;
        double y1 = y0 + sprite.Height * item.ScaleY;
        if (x >= Math.Min(x0, x1) && x <= Math.Max(x0, x1) &&
            y >= Math.Min(y0, y1) && y <= Math.Max(y0, y1)) return true;
    }
    return false;
}

void RenderRoom(UndertaleRoom room, int cameraX, int cameraY, string output)
{
    uint background = room.BGColorLayer?.BackgroundData?.Color ?? room.BackgroundColor;
    MagickImage canvas = new MagickImage(GMColor(background), 640, 480);
    canvas.Format = MagickFormat.Png32;
    foreach (var layer in room.Layers.Where(item => item.IsVisible).OrderByDescending(item => item.LayerDepth))
    {
        string layerName = layer.LayerName?.Content ?? "";
        if (layerName.StartsWith("DEBUG", StringComparison.OrdinalIgnoreCase)) continue;
        if (layer.LayerType == UndertaleRoom.LayerType.Background)
            DrawBackgroundLayer(canvas, room, layer, cameraX, cameraY);
        else if (layer.LayerType == UndertaleRoom.LayerType.Tiles)
            DrawTileLayer(canvas, layer, cameraX, cameraY);
        else if (layer.LayerType == UndertaleRoom.LayerType.Assets && layer.AssetsData != null)
        {
            foreach (var tile in layer.AssetsData.LegacyTiles)
                DrawTexture(canvas, tile.Tpag, tile.X, tile.Y, cameraX, cameraY,
                    tile.ScaleX, tile.ScaleY, 0, (byte)(tile.Color >> 24));
            foreach (var item in layer.AssetsData.Sprites)
            {
                var sprite = item.Sprite;
                var texture = sprite?.Textures.ElementAtOrDefault(item.WrappedFrameIndex)?.Texture;
                DrawTexture(canvas, texture,
                    (int)layer.XOffset + item.X - (sprite?.OriginXWrapper ?? 0),
                    (int)layer.YOffset + item.Y - (sprite?.OriginYWrapper ?? 0),
                    cameraX, cameraY, item.ScaleX, item.ScaleY,
                    item.OppositeRotation, (byte)(item.Color >> 24));
            }
        }
        else if (layer.LayerType == UndertaleRoom.LayerType.Instances && layer.InstancesData != null)
        {
            foreach (var item in layer.InstancesData.Instances)
            {
                // Ces sprites ne sont que des repères de collision visibles
                // dans l'éditeur de room ; leurs objets les masquent au runtime.
                if (IsEditorOnlyInstance(item)) continue;
                var sprite = item.ObjectDefinition?.Sprite;
                var texture = sprite?.Textures.ElementAtOrDefault(item.WrappedImageIndex)?.Texture;
                DrawTexture(canvas, texture,
                    item.X - (sprite?.OriginXWrapper ?? 0),
                    item.Y - (sprite?.OriginYWrapper ?? 0),
                    cameraX, cameraY, item.ScaleX, item.ScaleY,
                    item.OppositeRotation, (byte)(item.Color >> 24));
            }
        }
    }
    canvas.Write(output);
    canvas.Dispose();
}

JObject SceneAt(UndertaleRoom room, int cameraX, int cameraY, int focusX, int focusY)
{
    cameraX = Math.Max(0, Math.Min(cameraX, Math.Max(0, (int)room.Width - 640)));
    cameraY = Math.Max(0, Math.Min(cameraY, Math.Max(0, (int)room.Height - 480)));
    string sceneKey = room.Name.Content + ":" + cameraX + ":" + cameraY;
    string file = SafeName(room.Name.Content + "_" + cameraX + "_" + cameraY) + ".png";
    if (sceneResults[sceneKey] == null)
    {
        RenderRoom(room, cameraX, cameraY, Path.Combine(sceneFolder, file));
        sceneResults[sceneKey] = file;
        // Les chapitres récents emploient des milliers de textures. Un cache
        // borné évite que l'import des rooms dépende de la quantité de RAM.
        if (sceneResults.Count % 100 == 0) ClearImageCaches();
    }
    return new JObject {
        ["room"] = room.Name.Content,
        ["image"] = "room-scenes/" + file,
        ["roomWidth"] = room.Width,
        ["roomHeight"] = room.Height,
        ["cameraX"] = cameraX,
        ["cameraY"] = cameraY,
        ["focusX"] = focusX,
        ["focusY"] = focusY
    };
}

JObject SceneFor(UndertaleRoom room, int focusX, int focusY)
{
    JObject scene = SceneAt(room, focusX - 320, focusY - 240, focusX, focusY);
    // L'émetteur est souvent un décor haut (arbre, cloche...) alors que le
    // joueur se tient à ses pieds. Les deux sondes couvrent cette différence
    // sans figer une room particulière.
    bool bottom = PointInsideObject(room, focusX, focusY, "obj_plat_text_at_bottom_zone") ||
                  PointInsideObject(room, focusX, focusY + 80, "obj_plat_text_at_bottom_zone");
    scene["platformSide"] = bottom ? 1 : 0;
    return scene;
}

foreach (string requested in requestedObjects)
{
    JArray placements = new JArray();
    foreach (var room in Data.Rooms)
    foreach (var instance in room.GameObjects)
    {
        bool direct;
        if (!MatchesObject(instance.ObjectDefinition, requested, out direct)) continue;
        JObject scene = SceneFor(room, instance.X, instance.Y);
        scene["instanceId"] = instance.InstanceID;
        scene["sourceObject"] = instance.ObjectDefinition?.Name?.Content;
        scene["via"] = direct ? "direct" : "child";
        placements.Add(scene);
    }
    if (placements.Count > 0) objectResults[requested] = placements;
}

foreach (string requested in requestedRooms)
{
    var room = Data.Rooms.ByName(requested);
    if (room == null) continue;
    roomResults[requested] = SceneFor(room, (int)room.Width / 2, (int)room.Height / 2);
}

foreach (string request in requestedCameraViews)
{
    string[] parts = request.Split('|');
    if (parts.Length != 3) continue;
    string requested = parts[0];
    int cameraX;
    int cameraY;
    if (!Int32.TryParse(parts[1], out cameraX) || !Int32.TryParse(parts[2], out cameraY)) continue;
    JArray views = new JArray();
    foreach (var room in Data.Rooms)
    {
        bool roomMatches = false;
        foreach (var instance in room.GameObjects)
        {
            bool direct;
            if (MatchesObject(instance.ObjectDefinition, requested, out direct))
            {
                roomMatches = true;
                break;
            }
        }
        if (!roomMatches) continue;
        views.Add(SceneAt(room, cameraX, cameraY, cameraX + 320, cameraY + 240));
    }
    if (views.Count == 0) continue;
    if (cameraResults[requested] == null) cameraResults[requested] = new JObject();
    ((JObject)cameraResults[requested])[cameraX + ":" + cameraY] = views;
}

File.WriteAllText(Path.Combine(outRoot, "room-context.json"), root.ToString());
ClearImageCaches();
worker.Dispose();
ScriptMessage($"ROOM_CONTEXT_OK {objectResults.Count} objects, {sceneResults.Count} vues");
