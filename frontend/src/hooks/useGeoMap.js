import { useCallback, useEffect, useRef } from "react";
import { mergeTags, safeParse } from "../utils/osm";

function toGeographicExtent(webMercatorUtils, extent) {
  if (!extent) return null;
  if (!webMercatorUtils?.webMercatorToGeographic) return extent;
  if (extent.spatialReference?.wkid === 4326) return extent;
  return webMercatorUtils.webMercatorToGeographic(extent);
}

function toBboxString(ext) {
  const { xmin, ymin, xmax, ymax } = ext;
  if ([xmin, ymin, xmax, ymax].some((n) => Math.abs(n) > 180 || Math.abs(ymin) > 90 || Math.abs(ymax) > 90)) {
    return null;
  }
  return `${ymin.toFixed(4)},${xmin.toFixed(4)},${ymax.toFixed(4)},${xmax.toFixed(4)}`;
}

function lookupCI(bag, key) {
  if (!bag) return undefined;
  if (key in bag) return bag[key];
  const lowerKey = key.toLowerCase();
  const foundKey = Object.keys(bag).find((k) => k.toLowerCase() === lowerKey);
  return foundKey ? bag[foundKey] : undefined;
}

function firstFrom(attrs, tags, keys) {
  return keys
    .map((k) => lookupCI(attrs, k) ?? lookupCI(tags, k))
    .find((v) => v !== undefined && v !== null && v !== "");
}

export function useGeoMap({ onBboxChange, initialBboxParts, setStatus }) {
  const mapRef = useRef(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const isInitializedRef = useRef(false);

  const addGeoJsonLayer = useCallback(async (featureCollection, title = "Layer") => {
    if (!featureCollection) return;
    if (!viewRef.current) {
      throw new Error("Map is not ready yet. Try again in a moment.");
    }
    const [{ default: GeoJSONLayer }] = await Promise.all([import("@arcgis/core/layers/GeoJSONLayer")]);

    if (layerRef.current && viewRef.current?.map) {
      viewRef.current.map.remove(layerRef.current);
    }

    const prepared = mergeTags(featureCollection);
    const blob = new Blob([JSON.stringify(prepared)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const layer = new GeoJSONLayer({
      url,
      title,
      outFields: ["*"],
      popupTemplate: {
        title: (evt) => {
          const attrs = evt?.graphic?.attributes || {};
          const tagsRaw = attrs.tags;
          const tags = typeof tagsRaw === "string" ? safeParse(tagsRaw) : tagsRaw || {};
          return (
            firstFrom(attrs, tags, [
              "name",
              "official_name",
              "loc_name",
              "local_name",
              "alt_name",
              "ref",
              "@id",
              "id",
            ]) || "Station"
          );
        },
        content: (evt) => {
          const attrs = evt?.graphic?.attributes || {};
          const tagsRaw = attrs.tags;
          const tags = typeof tagsRaw === "string" ? safeParse(tagsRaw) : tagsRaw || {};
          const val = (keys) => firstFrom(attrs, tags, Array.isArray(keys) ? keys : [keys]) ?? "-";

          const rows = [
            `<div><b>Name:</b> ${val(["name", "official_name", "loc_name", "local_name", "alt_name", "ref", "@id", "id"])}</div>`,
            `<div><b>Type:</b> ${val(["public_transport", "railway", "highway", "type", "amenity", "category", "route", "bus", "tram", "light_rail"])}</div>`,
            `<div><b>Lines / Routes:</b> ${val(["route_ref", "lines", "bus_routes", "tram_routes", "train_lines", "subway_lines", "light_rail_lines", "bus", "tram", "trolleybus", "subway", "ref"])}</div>`,
            `<div><b>Operator:</b> ${val(["operator", "brand", "company"])}</div>`,
            `<div><b>Network:</b> ${val(["network", "system", "agency"])}</div>`,
          ];

          const hasData = rows.some((r) => !r.includes("> -<"));
          if (!hasData && tags && typeof tags === "object") {
            const extras = Object.entries(tags)
              .slice(0, 8)
              .map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`);
            if (extras.length) {
              rows.push("<hr/>");
              rows.push(...extras);
            }
          }

          return `<div style="font-size:14px; line-height:1.4;">${rows.join("")}</div>`;
        },
      },
    });

    layerRef.current = layer;
    viewRef.current.map.add(layer);
    viewRef.current.goTo(layer);
  }, []);

  const goToBbox = useCallback(
    async (parts) => {
      if (!parts) return;
      if (!viewRef.current) throw new Error("Map is not ready yet. Try again in a moment.");
      const [south, west, north, east] = parts;
      const [{ default: Extent }] = await Promise.all([import("@arcgis/core/geometry/Extent")]);
      
      const extent = new Extent({
        xmin: west,
        ymin: south,
        xmax: east,
        ymax: north,
        spatialReference: { wkid: 4326 },
      });
      
      await viewRef.current.goTo(extent, { animate: true });
    },
    []
  );

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    let view;
    let watchHandle;
    let debounceTimer;
    let lastBbox = null;
    let skipNext = true;
    let programmaticMove = false;

    async function initMap() {
      const [{ default: Map }, { default: MapView }, wmModule] = await Promise.all([
        import("@arcgis/core/Map"),
        import("@arcgis/core/views/MapView"),
        import("@arcgis/core/geometry/support/webMercatorUtils"),
      ]);
      const webMercatorUtils = wmModule?.webMercatorToGeographic ? wmModule : wmModule?.default;

      const map = new Map({ basemap: "streets-navigation-vector" });
      view = new MapView({
        container: mapRef.current,
        map,
        center: [26.1, 44.44],
        zoom: 11,
      });
      
      viewRef.current = view;
      await view.when();

      if (initialBboxParts) {
        try {
          const [south, west, north, east] = initialBboxParts;
          const { default: Extent } = await import("@arcgis/core/geometry/Extent");
          programmaticMove = true;
          await view.goTo(new Extent({
            xmin: west,
            ymin: south,
            xmax: east,
            ymax: north,
            spatialReference: { wkid: 4326 },
          }), { animate: false });
          setTimeout(() => { programmaticMove = false; }, 1000);
        } catch (err) {
          setStatus?.(err.message);
        }
      }

      watchHandle = view.watch("extent", (ext) => {
        if (!ext) return;
        
        if (skipNext) {
          skipNext = false;
          return;
        }

        if (programmaticMove) {
          return;
        }
        
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(() => {
          const geoExt = toGeographicExtent(webMercatorUtils, ext);
          if (!geoExt) return;
          
          const bboxString = toBboxString(geoExt);
          
          if (bboxString && bboxString !== lastBbox) {
            lastBbox = bboxString;
            onBboxChange?.(bboxString);
          }
        }, 800);
      });
    }

    initMap().catch((err) => setStatus?.(err.message));

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (watchHandle) watchHandle.remove();
      if (view) view.destroy();
    };
  }, []);

  return { mapRef, addGeoJsonLayer, goToBbox };
}
