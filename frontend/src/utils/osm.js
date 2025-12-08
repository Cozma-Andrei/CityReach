export function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (_e) {
    return {};
  }
}

export function mergeTags(featureCollection) {
  if (!featureCollection?.features) return featureCollection;
  return {
    ...featureCollection,
    features: featureCollection.features.map((feat) => {
      const props = feat.properties || {};
      const tagsRaw = props.tags;
      const tagsObj = typeof tagsRaw === "string" ? safeParse(tagsRaw) : tagsRaw || {};
      const merged = { ...props, ...tagsObj, tags: tagsObj, "@id": props["@id"] || props.id };
      return { ...feat, properties: merged };
    }),
  };
}
