object CloneSequenceValue(object value, Dictionary<object, object> visited)
{
    if (value is null)
        return null;

    Type type = value.GetType();
    if (type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(decimal) ||
        value is UndertaleString)
        return value;

    if (visited.TryGetValue(value, out object known))
        return known;

    if (type.IsArray)
    {
        var sourceArray = (Array)value;
        var targetArray = Array.CreateInstance(type.GetElementType(), sourceArray.Length);
        visited[value] = targetArray;
        for (int i = 0; i < sourceArray.Length; i++)
            targetArray.SetValue(CloneSequenceValue(sourceArray.GetValue(i), visited), i);
        return targetArray;
    }

    if (value is IList sourceList)
    {
        var targetList = (IList)Activator.CreateInstance(type, true);
        visited[value] = targetList;
        foreach (object item in sourceList)
            targetList.Add(CloneSequenceValue(item, visited));
        return targetList;
    }

    string fullName = type.FullName ?? "";
    if (!fullName.StartsWith("UndertaleModLib.Models.UndertaleSequence", StringComparison.Ordinal))
        return value;

    object clone = Activator.CreateInstance(type, true)
        ?? throw new InvalidOperationException($"Impossible de cloner {fullName}");
    visited[value] = clone;

    foreach (var property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
    {
        if (!property.CanRead || !property.CanWrite || property.GetIndexParameters().Length != 0)
            continue;
        property.SetValue(clone, CloneSequenceValue(property.GetValue(value), visited));
    }
    foreach (var field in type.GetFields(BindingFlags.Instance | BindingFlags.Public))
        field.SetValue(clone, CloneSequenceValue(field.GetValue(value), visited));

    return clone;
}

UndertaleSequence CloneSequence(UndertaleSequence source, string targetName)
{
    var visited = new Dictionary<object, object>(ReferenceEqualityComparer.Instance);
    var clone = (UndertaleSequence)CloneSequenceValue(source, visited);
    clone.Name = Data.Strings.MakeString(targetName + "_sequence");
    return clone;
}

UndertaleSprite.NineSlice CloneNineSlice(UndertaleSprite.NineSlice source)
{
    if (source is null)
        return null;
    return new UndertaleSprite.NineSlice
    {
        Left = source.Left,
        Top = source.Top,
        Right = source.Right,
        Bottom = source.Bottom,
        Enabled = source.Enabled,
        TileModes = source.TileModes?.ToArray()
    };
}

UndertaleSprite CloneSprite(UndertaleSprite source, string targetName)
{
    var clone = new UndertaleSprite
    {
        Name = Data.Strings.MakeString(targetName),
        Width = source.Width,
        Height = source.Height,
        MarginLeft = source.MarginLeft,
        MarginRight = source.MarginRight,
        MarginTop = source.MarginTop,
        MarginBottom = source.MarginBottom,
        Transparent = source.Transparent,
        Smooth = source.Smooth,
        Preload = source.Preload,
        BBoxMode = source.BBoxMode,
        SepMasks = source.SepMasks,
        OriginX = source.OriginX,
        OriginY = source.OriginY,
        IsSpecialType = source.IsSpecialType,
        SVersion = source.SVersion,
        SSpriteType = source.SSpriteType,
        GMS2PlaybackSpeed = source.GMS2PlaybackSpeed,
        GMS2PlaybackSpeedType = source.GMS2PlaybackSpeedType,
        SpineVersion = source.SpineVersion,
        SpineCacheVersion = source.SpineCacheVersion,
        SpineHasTextureData = source.SpineHasTextureData,
        SpineJSON = source.SpineJSON,
        SpineAtlas = source.SpineAtlas,
        SWFVersion = source.SWFVersion,
        YYSWF = source.YYSWF,
        SpineTextures = source.SpineTextures,
        VectorVersion = source.VectorVersion,
        VectorCollisionMaskWidth = source.VectorCollisionMaskWidth,
        VectorCollisionMaskHeight = source.VectorCollisionMaskHeight,
        VectorFrameToShapeMap = source.VectorFrameToShapeMap,
        VectorShapes = source.VectorShapes,
        VectorCollisionMaskRLEData = source.VectorCollisionMaskRLEData,
        V2Sequence = source.V2Sequence is null ? null : CloneSequence(source.V2Sequence, targetName),
        V3NineSlice = CloneNineSlice(source.V3NineSlice)
    };

    clone.Textures.Clear();
    foreach (var frame in source.Textures)
    {
        clone.Textures.Add(frame is null
            ? null
            : new UndertaleSprite.TextureEntry { Texture = frame.Texture });
    }

    clone.CollisionMasks.Clear();
    foreach (var mask in source.CollisionMasks)
    {
        clone.CollisionMasks.Add(new UndertaleSprite.MaskEntry(
            mask.Data.ToArray(), mask.Width, mask.Height));
    }

    return clone;
}
