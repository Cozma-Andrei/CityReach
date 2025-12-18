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
  const bufferGraphicsRef = useRef(null);
  const stationsFeaturesRef = useRef(null);
  const isInitializedRef = useRef(false);

  const addGeoJsonLayer = useCallback(async (featureCollection, title = "Layer", buffersData = null) => {
    if (!featureCollection) return;
    if (!viewRef.current) {
      throw new Error("Map is not ready yet. Try again in a moment.");
    }
    const [{ default: GeoJSONLayer }] = await Promise.all([import("@arcgis/core/layers/GeoJSONLayer")]);

    if (layerRef.current && viewRef.current?.map) {
      viewRef.current.map.remove(layerRef.current);
    }

    const isStations = title.toLowerCase() === "stations" || title.toLowerCase().includes("station");
    const isNeighborhoods = title.toLowerCase() === "neighborhoods" || title.toLowerCase().includes("neighborhood");
    const firstFeature = featureCollection.features && featureCollection.features.length > 0 ? featureCollection.features[0] : null;
    const firstProps = firstFeature?.properties || {};
    const isFromFirestore = title === "stations" || title === "neighborhoods" || 
                           (firstProps.type || firstProps.population !== undefined);

    const prepared = isFromFirestore ? featureCollection : mergeTags(featureCollection);
    
    if (isStations && buffersData) {
      stationsFeaturesRef.current = { stations: prepared, buffers: buffersData };
      console.log("Stations features ref set:", { 
        stationsCount: prepared.features?.length, 
        buffersCount: buffersData.features?.length,
        firstStation: prepared.features?.[0],
        firstBuffer: buffersData.features?.[0]
      });
    }
    
    const featuresMap = new Map();
    if (isFromFirestore && prepared.features) {
      prepared.features.forEach((f, index) => {
        if (f.properties) {
          const featureId = f.id || f.properties.id || index;
          featuresMap.set(featureId, f);
          featuresMap.set(index, f);
          featuresMap.set(String(index), f);
          featuresMap.set(String(featureId), f);
        }
      });
    }
    
    if (isFromFirestore && prepared.features) {
      prepared.features.forEach((f, index) => {
        const featureId = f.id || f.properties?.id || index;
        if (!f.properties) f.properties = {};
        f.properties.id = featureId;
      });
    }
    
    const blob = new Blob([JSON.stringify(prepared)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const popupTemplate = isFromFirestore && isStations
      ? {
          title: (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "Station";
            
            const attrs = graphic.attributes || {};
            let props = {};
            
            const objectId = attrs.__OBJECTID;
            if (objectId !== undefined && prepared.features && prepared.features[objectId]) {
              props = prepared.features[objectId].properties || {};
            } else {
              const featureId = attrs.id || attrs.ID || objectId;
              if (featureId !== undefined && featuresMap.has(featureId)) {
                props = featuresMap.get(featureId).properties || {};
              } else if (featuresMap.has(String(featureId))) {
                props = featuresMap.get(String(featureId)).properties || {};
              }
            }
            
            return attrs.name || props.name || "Station";
          },
          content: (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "";
            
            const attrs = graphic.attributes || {};
            let props = {};
            
            const objectId = attrs.__OBJECTID;
            if (objectId !== undefined && prepared.features && prepared.features[objectId]) {
              props = prepared.features[objectId].properties || {};
            } else {
              const featureId = attrs.id || attrs.ID || objectId;
              if (featureId !== undefined && featuresMap.has(featureId)) {
                props = featuresMap.get(featureId).properties || {};
              } else if (featuresMap.has(String(featureId))) {
                props = featuresMap.get(String(featureId)).properties || {};
              }
            }
            
            const rows = [];
            const name = attrs.name || props.name;
            const type = attrs.type || props.type;
            const bufferRadius = attrs.bufferRadius || props.bufferRadius;
            
            if (name) rows.push(`<div><b>Name:</b> ${name}</div>`);
            if (type) rows.push(`<div><b>Type:</b> ${type}</div>`);
            if (bufferRadius) rows.push(`<div><b>Buffer Radius:</b> ${bufferRadius} m</div>`);
            
            return rows.length > 0 ? `<div style="font-size:14px; line-height:1.4;">${rows.join("")}</div>` : "";
          },
        }
      : isFromFirestore && isNeighborhoods
      ? {
          title: (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "Neighborhood";
            
            const attrs = graphic.attributes || {};
            let props = {};
            
            const objectId = attrs.__OBJECTID;
            if (objectId !== undefined && prepared.features && prepared.features[objectId]) {
              props = prepared.features[objectId].properties || {};
            } else {
              const featureId = attrs.id || attrs.ID || objectId;
              if (featureId !== undefined && featuresMap.has(featureId)) {
                props = featuresMap.get(featureId).properties || {};
              } else if (featuresMap.has(String(featureId))) {
                props = featuresMap.get(String(featureId)).properties || {};
              }
            }
            
            return attrs.name || props.name || "Neighborhood";
          },
          content: async (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "";
            
            const attrs = graphic.attributes || {};
            let props = {};
            
            const objectId = attrs.__OBJECTID;
            if (objectId !== undefined && prepared.features && prepared.features[objectId]) {
              props = prepared.features[objectId].properties || {};
            } else {
              const featureId = attrs.id || attrs.ID || objectId;
              if (featureId !== undefined && featuresMap.has(featureId)) {
                props = featuresMap.get(featureId).properties || {};
              } else if (featuresMap.has(String(featureId))) {
                props = featuresMap.get(String(featureId)).properties || {};
              }
            }
            
            const name = attrs.name || props.name;
            const population = attrs.population !== undefined ? attrs.population : props.population;
            const featureId = attrs.id || props.id || attrs.ID || props.ID || prepared.features?.[objectId]?.id || prepared.features?.[objectId]?.properties?.id;
            
            console.log("Update population - featureId:", featureId, "attrs:", attrs, "props:", props, "objectId:", objectId);
            
            const container = document.createElement("div");
            container.style.cssText = "font-size:14px; line-height:1.4;";
            
            if (name) {
              const nameDiv = document.createElement("div");
              nameDiv.innerHTML = `<b>Name:</b> ${name}`;
              container.appendChild(nameDiv);
            }
            
            const popDiv = document.createElement("div");
            popDiv.style.cssText = "margin-top:8px;";
            popDiv.innerHTML = `<b>Population:</b> <span class="pop-display">${population !== undefined && population !== null ? population.toLocaleString() : 0}</span>`;
            container.appendChild(popDiv);
            
            const editDiv = document.createElement("div");
            editDiv.style.cssText = "margin-top:12px; padding-top:12px; border-top:1px solid #ddd;";
            
            const label = document.createElement("label");
            label.textContent = "Edit Population:";
            label.style.cssText = "font-weight:600; display:block; margin-bottom:6px;";
            
            const inputContainer = document.createElement("div");
            inputContainer.style.cssText = "display:flex; align-items:center; gap:8px;";
            
            const input = document.createElement("input");
            input.type = "number";
            input.value = population || 0;
            input.min = "0";
            input.style.cssText = "width:120px; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:13px;";
            
            const updateBtn = document.createElement("button");
            updateBtn.textContent = "Update";
            updateBtn.style.cssText = "padding:6px 12px; background:#0079c1; color:white; border:none; border-radius:4px; cursor:pointer; font-size:13px;";
            
            updateBtn.addEventListener("click", async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const popValue = Number(input.value);
              if (isNaN(popValue) || popValue < 0) {
                alert("Population must be a non-negative number");
                return;
              }
              
              try {
                updateBtn.disabled = true;
                updateBtn.textContent = "Updating...";
                const success = await window.updatePopulation(featureId, popValue);
                if (success) {
                  const popDisplay = container.querySelector(".pop-display");
                  if (popDisplay) {
                    popDisplay.textContent = popValue.toLocaleString();
                  }
                  input.value = popValue;
                }
              } catch (err) {
                console.error("Update error:", err);
              } finally {
                updateBtn.disabled = false;
                updateBtn.textContent = "Update";
              }
            });
            
            inputContainer.appendChild(input);
            inputContainer.appendChild(updateBtn);
            editDiv.appendChild(label);
            editDiv.appendChild(inputContainer);
            container.appendChild(editDiv);
            
            return container;
          },
        }
      : {
          title: (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "Unknown";
            
            const attrs = graphic.attributes || {};
            const tagsRaw = attrs.tags;
            const tags = typeof tagsRaw === "string" ? safeParse(tagsRaw) : tagsRaw || {};
            return (
              firstFrom(attrs, tags, [
                "name",
                "official_name",
                "loc_name",
                "local_name",
                "alt_name",
              ]) || (isStations ? "Station" : "Neighborhood")
            );
          },
          content: (evt) => {
            const graphic = evt?.graphic;
            if (!graphic) return "";
            
            const attrs = graphic.attributes || {};
        
        const tagsRaw = attrs.tags;
        const tags = typeof tagsRaw === "string" ? safeParse(tagsRaw) : tagsRaw || {};
        const val = (keys) => {
          const result = firstFrom(attrs, tags, Array.isArray(keys) ? keys : [keys]);
          return result && result !== "-" ? result : null;
        };

        const rows = [];
        const name = val(["name", "official_name", "loc_name", "local_name", "alt_name"]);
        if (name) rows.push(`<div><b>Name:</b> ${name}</div>`);
        
        if (isStations) {
          const type = val(["public_transport", "railway", "highway", "type", "amenity"]);
          if (type) rows.push(`<div><b>Type:</b> ${type}</div>`);
          
          const routes = val(["route_ref", "lines", "bus_routes", "tram_routes", "ref"]);
          if (routes) rows.push(`<div><b>Routes:</b> ${routes}</div>`);
          
          const operator = val(["operator", "brand", "company"]);
          if (operator) rows.push(`<div><b>Operator:</b> ${operator}</div>`);
        } else {
          const population = val(["population", "population:total", "pop"]);
          if (population) rows.push(`<div><b>Population:</b> ${population}</div>`);
        }

        if (rows.length === 0 && tags && typeof tags === "object") {
          const extras = Object.entries(tags)
            .filter(([k, v]) => v && v !== "-" && v !== "")
            .slice(0, 5)
            .map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`);
          if (extras.length) {
            rows.push(...extras);
          }
        }

        return rows.length > 0 ? `<div style="font-size:14px; line-height:1.4;">${rows.join("")}</div>` : "";
      },
    };
    
    console.log("Creating layer with:", { title, isFromFirestore, isStations, isNeighborhoods });
    if (isFromFirestore && prepared.features && prepared.features.length > 0) {
      console.log("First feature properties:", prepared.features[0].properties);
    }
    
    const layer = new GeoJSONLayer({
      url,
      title,
      outFields: ["*"],
      fields: isFromFirestore 
        ? (isStations 
          ? [
              { name: "id", type: "string" },
              { name: "name", type: "string" },
              { name: "type", type: "string" },
              { name: "bufferRadius", type: "double" },
            ]
          : [
              { name: "id", type: "string" },
              { name: "name", type: "string" },
              { name: "population", type: "double" },
            ])
        : undefined,
      objectIdField: "id",
      popupTemplate,
    });
    
    layer.when(async () => {
      console.log("Layer loaded successfully");
      
      if (isStations && stationsFeaturesRef.current?.buffers) {
        const [{ default: GraphicsLayer }, { default: Polygon }, { default: SimpleFillSymbol }, { default: SimpleLineSymbol }, { default: Graphic }] = await Promise.all([
          import("@arcgis/core/layers/GraphicsLayer"),
          import("@arcgis/core/geometry/Polygon"),
          import("@arcgis/core/symbols/SimpleFillSymbol"),
          import("@arcgis/core/symbols/SimpleLineSymbol"),
          import("@arcgis/core/Graphic")
        ]);
        
        if (!bufferGraphicsRef.current) {
          const bufferGraphicsLayer = new GraphicsLayer({ title: "Buffers" });
          viewRef.current.map.add(bufferGraphicsLayer);
          bufferGraphicsRef.current = bufferGraphicsLayer;
          
          const showBufferForStation = (graphic) => {
            if (!graphic || !bufferGraphicsRef.current) {
              console.log("showBufferForStation: missing graphic or bufferGraphicsRef", { graphic: !!graphic, bufferRef: !!bufferGraphicsRef.current });
              return;
            }
            
            bufferGraphicsRef.current.removeAll();
            
            const attrs = graphic.attributes || {};
            const objectId = attrs.__OBJECTID;
            
            console.log("showBufferForStation:", { objectId, attrs, stationsCount: stationsFeaturesRef.current?.stations?.features?.length, buffersCount: stationsFeaturesRef.current?.buffers?.features?.length });
            
            if (objectId !== undefined && stationsFeaturesRef.current?.stations?.features) {
              let stationFeature = null;
              let stationId = null;
              
              if (typeof objectId === "number" && stationsFeaturesRef.current.stations.features[objectId]) {
                stationFeature = stationsFeaturesRef.current.stations.features[objectId];
                stationId = stationFeature.id || stationFeature.properties?.id;
              } else {
                stationFeature = stationsFeaturesRef.current.stations.features.find(f => {
                  const fid = f.id || f.properties?.id;
                  const attrsId = attrs.id || attrs.ID;
                  return fid === attrsId || fid === objectId || attrsId === objectId;
                });
                
                if (stationFeature) {
                  stationId = stationFeature.id || stationFeature.properties?.id;
                } else if (attrs.id || attrs.ID) {
                  stationId = attrs.id || attrs.ID;
                }
              }
              
              console.log("Found station feature:", stationFeature, "stationId:", stationId);
              
              if (stationId && stationsFeaturesRef.current.buffers?.features) {
                const bufferFeature = stationsFeaturesRef.current.buffers.features.find(
                  bf => {
                    const match = bf.properties?.stationId === stationId || 
                                 bf.id === `buffer_${stationId}` || 
                                 bf.id?.endsWith(String(stationId)) ||
                                 bf.id?.includes(String(stationId)) ||
                                 (bf.properties?.stationId && bf.properties.stationId.toString() === stationId.toString());
                    if (match) {
                      console.log("Found buffer feature:", bf);
                    }
                    return match;
                  }
                );
                
                if (bufferFeature && bufferFeature.geometry) {
                  console.log("Creating buffer graphic from:", bufferFeature.geometry);
                  const coords = bufferFeature.geometry.coordinates;
                  let rings = coords;
                  if (bufferFeature.geometry.type === "Polygon") {
                    rings = coords;
                  } else if (bufferFeature.geometry.type === "MultiPolygon") {
                    rings = coords[0];
                  }
                  
                  const polygon = new Polygon({
                    rings: rings,
                    spatialReference: { wkid: 4326 }
                  });
                  
                  const fillSymbol = new SimpleFillSymbol({
                    color: [0, 100, 255, 0.2],
                    outline: new SimpleLineSymbol({
                      color: [0, 100, 255, 0.6],
                      width: 2
                    })
                  });
                  
                  const bufferGraphic = new Graphic({
                    geometry: polygon,
                    symbol: fillSymbol
                  });
                  
                  bufferGraphicsRef.current.add(bufferGraphic);
                  console.log("Buffer graphic added to layer");
                } else {
                  console.log("No buffer feature found or missing geometry", { bufferFeature: !!bufferFeature, hasGeometry: bufferFeature?.geometry, stationId });
                }
              } else {
                console.log("Could not find stationId for objectId:", objectId, "stationFeature:", stationFeature);
              }
            } else {
              console.log("Missing stations or objectId:", { hasStations: !!stationsFeaturesRef.current?.stations?.features, objectId });
            }
          };
          
          const popupWatchHandle = viewRef.current.popup.watch("visible", (visible) => {
            console.log("Popup visibility changed:", visible);
            if (!visible && bufferGraphicsRef.current) {
              bufferGraphicsRef.current.removeAll();
            } else if (visible && viewRef.current.popup.selectedFeature) {
              const selectedGraphic = viewRef.current.popup.selectedFeature;
              console.log("Popup opened with selectedFeature:", selectedGraphic);
              if (selectedGraphic?.layer === layer) {
                showBufferForStation(selectedGraphic);
              }
            }
          });
          
          const clickHandle = viewRef.current.on("click", async (event) => {
            console.log("Map clicked");
            const result = await viewRef.current.hitTest(event);
            const graphic = result.results.find(r => r.graphic?.layer === layer)?.graphic;
            console.log("Hit test result for stations layer:", graphic);
            if (graphic) {
              showBufferForStation(graphic);
            }
          });
        }
      }
    }).catch(err => {
      console.error("Layer load error:", err);
    });

    if (layerRef.current && viewRef.current?.map) {
      viewRef.current.map.remove(layerRef.current);
    }
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
      
      await viewRef.current.goTo(extent, { 
        animate: true,
        duration: 1000,
        maxZoom: 15,
        padding: { left: 50, top: 50, right: 50, bottom: 50 }
      });
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
      const [{ default: Map }, { default: MapView }, { default: Popup }, wmModule] = await Promise.all([
        import("@arcgis/core/Map"),
        import("@arcgis/core/views/MapView"),
        import("@arcgis/core/widgets/Popup"),
        import("@arcgis/core/geometry/support/webMercatorUtils"),
      ]);
      const webMercatorUtils = wmModule?.webMercatorToGeographic ? wmModule : wmModule?.default;

      const map = new Map({ basemap: "streets-navigation-vector" });
      view = new MapView({
        container: mapRef.current,
        map,
        popup: new Popup({
          dockEnabled: true,
          dockOptions: {
            buttonEnabled: true,
            breakpoint: false,
            position: "bottom-right",
          },
        }),
      });
      
      viewRef.current = view;
      await view.when();

      if (initialBboxParts && initialBboxParts.length === 4) {
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
          console.error("Error setting initial extent:", err);
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
