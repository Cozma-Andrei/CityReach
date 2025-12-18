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

export function useGeoMap({ onBboxChange, initialBboxParts, setStatus, transportFilters, adminLevelFilters }) {
  const mapRef = useRef(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const bufferGraphicsRef = useRef(null);
  const stationsFeaturesRef = useRef(null);
  const stationsLayerRef = useRef(null);
  const neighborhoodsLayerRef = useRef(null);
  const intersectionsLayerRef = useRef(null);
  const highlightGraphicsLayerRef = useRef(null);
  const neighborhoodClickHandlerRef = useRef(null);
  const isInitializedRef = useRef(false);
  const currentFiltersRef = useRef(transportFilters);
  const currentAdminLevelFiltersRef = useRef(adminLevelFilters);

  const addGeoJsonLayer = useCallback(async (featureCollection, title = "Layer", buffersData = null) => {
    if (!featureCollection) return;
    if (!viewRef.current) {
      throw new Error("Map is not ready yet. Try again in a moment.");
    }
    
    const isStations = title.toLowerCase() === "stations" || title.toLowerCase().includes("station");
    const isNeighborhoods = title.toLowerCase() === "neighborhoods" || title.toLowerCase().includes("neighborhood");
    
    const imports = [import("@arcgis/core/layers/GeoJSONLayer")];
    if (isStations) {
      imports.push(
        import("@arcgis/core/renderers/UniqueValueRenderer"),
        import("@arcgis/core/symbols/SimpleMarkerSymbol")
      );
    }
    if (isNeighborhoods) {
      imports.push(
        import("@arcgis/core/renderers/SimpleRenderer"),
        import("@arcgis/core/symbols/SimpleFillSymbol"),
        import("@arcgis/core/symbols/SimpleLineSymbol")
      );
    }
    const [{ default: GeoJSONLayer }, ...rendererImports] = await Promise.all(imports);

    if (layerRef.current && viewRef.current?.map) {
      console.log("Removing old layer:", layerRef.current.title);
      viewRef.current.map.remove(layerRef.current);
    }
    
    if (bufferGraphicsRef.current && viewRef.current?.map) {
      viewRef.current.map.remove(bufferGraphicsRef.current);
      bufferGraphicsRef.current = null;
    }
    
    const firstFeature = featureCollection.features && featureCollection.features.length > 0 ? featureCollection.features[0] : null;
    const firstProps = firstFeature?.properties || {};
    const isFromFirestore = title === "stations" || title === "neighborhoods" || 
                           (firstProps.type || firstProps.population !== undefined);

    const prepared = isFromFirestore ? featureCollection : mergeTags(featureCollection);
    
    if (isStations && buffersData && buffersData.features && buffersData.features.length > 0) {
      stationsFeaturesRef.current = { stations: prepared, buffers: buffersData };
      console.log("Stations features ref set:", { 
        stationsCount: prepared.features?.length, 
        buffersCount: buffersData.features?.length,
        firstStation: prepared.features?.[0],
        firstStationId: prepared.features?.[0]?.id || prepared.features?.[0]?.properties?.id,
        firstBuffer: buffersData.features?.[0],
        firstBufferStationId: buffersData.features?.[0]?.properties?.stationId,
        firstBufferId: buffersData.features?.[0]?.id
      });
    } else if (isStations && !buffersData) {
      console.log("Stations loaded without buffers, clearing stationsFeaturesRef");
      stationsFeaturesRef.current = null;
    } else {
      console.log("Non-stations layer loaded, keeping stationsFeaturesRef:", { 
        isStations, 
        hasStationsRef: !!stationsFeaturesRef.current,
        title 
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
        if (isNeighborhoods && f.properties.admin_level === null || f.properties.admin_level === undefined) {
          console.log("Feature missing admin_level:", f.id, f.properties);
        }
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
            const lines = attrs.lines || props.lines;
            
            if (name) rows.push(`<div><b>Name:</b> ${name}</div>`);
            if (type) rows.push(`<div><b>Type:</b> ${type}</div>`);
            if (lines) rows.push(`<div><b>Lines:</b> ${lines}</div>`);
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
          
          const routes = val(["route_ref", "lines", "bus_routes", "tram_routes", "ref", "tram:ref", "subway:ref", "metro:ref", "network"]);
          if (routes) rows.push(`<div><b>Lines:</b> ${routes}</div>`);
          
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
    
    let renderer = undefined;
    
    if (isStations && isFromFirestore && rendererImports.length >= 2) {
      const [{ default: UniqueValueRenderer }, { default: SimpleMarkerSymbol }] = rendererImports;
      
      renderer = new UniqueValueRenderer({
        field: "type",
        defaultSymbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [128, 128, 128, 0.8],
          size: 8,
          outline: {
            color: [255, 255, 255, 0.8],
            width: 1
          }
        }),
        uniqueValueInfos: [
          {
            value: "bus",
            symbol: new SimpleMarkerSymbol({
              style: "circle",
              color: [0, 150, 255, 0.8],
              size: 8,
              outline: {
                color: [255, 255, 255, 0.8],
                width: 1
              }
            }),
            label: "Bus"
          },
          {
            value: "tram",
            symbol: new SimpleMarkerSymbol({
              style: "circle",
              color: [255, 150, 0, 0.8],
              size: 8,
              outline: {
                color: [255, 255, 255, 0.8],
                width: 1
              }
            }),
            label: "Tram"
          },
          {
            value: "metro",
            symbol: new SimpleMarkerSymbol({
              style: "circle",
              color: [255, 0, 0, 0.8],
              size: 8,
              outline: {
                color: [255, 255, 255, 0.8],
                width: 1
              }
            }),
            label: "Metro"
          }
        ]
      });
    } else if (isNeighborhoods && isFromFirestore && rendererImports.length >= 3) {
      const [{ default: SimpleRenderer }, { default: SimpleFillSymbol }, { default: SimpleLineSymbol }] = rendererImports;
      
      renderer = new SimpleRenderer({
        symbol: new SimpleFillSymbol({
          color: [100, 200, 100, 0.3],
          outline: new SimpleLineSymbol({
            color: [50, 150, 50, 0.8],
            width: 2
          })
        })
      });
      
      console.log("Created renderer for neighborhoods");
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
              { name: "lines", type: "string" },
            ]
          : [
              { name: "id", type: "string" },
              { name: "name", type: "string" },
              { name: "population", type: "double" },
              { name: "admin_level", type: "string" },
            ])
        : undefined,
      objectIdField: "id",
      popupTemplate,
      renderer,
    });
    
    console.log("Creating layer:", { title, isStations, isNeighborhoods, isFromFirestore, hasRenderer: !!renderer });
    
    if (isStations && isFromFirestore && currentFiltersRef.current) {
      const filters = currentFiltersRef.current;
      const definitionExpression = Object.entries(filters)
        .filter(([_, enabled]) => !enabled)
        .map(([type, _]) => `type <> '${type}'`)
        .join(" AND ");
      
      layer.definitionExpression = definitionExpression || "1=1";
      console.log("Set initial definition expression for stations:", definitionExpression || "1=1");
    } else if (isNeighborhoods && isFromFirestore && currentAdminLevelFiltersRef.current) {
      const filters = currentAdminLevelFiltersRef.current;
      const includedLevels = [];
      if (filters.level8 === true) includedLevels.push("8");
      if (filters.level9 === true) includedLevels.push("9");
      if (filters.level10 === true) includedLevels.push("10");
      
      console.log("Setting initial definition expression for neighborhoods:", { filters, includedLevels });
      
      if (includedLevels.length === 0) {
        layer.definitionExpression = "1=0";
        console.log("All admin levels disabled for neighborhoods");
      } else if (includedLevels.length === 3) {
        layer.definitionExpression = null;
        console.log("All admin levels enabled for neighborhoods");
      } else {
        const definitionExpression = `admin_level IN ('${includedLevels.join("','")}')`;
        layer.definitionExpression = definitionExpression;
        console.log("Set definition expression for neighborhoods:", definitionExpression, "includedLevels:", includedLevels);
      }
    } else {
      layer.definitionExpression = null;
      console.log("No definition expression for layer:", title);
    }
    
    layer.when(async () => {
      console.log("Layer loaded successfully", { 
        title, 
        isStations, 
        hasStationsRef: !!stationsFeaturesRef.current, 
        hasBuffers: !!stationsFeaturesRef.current?.buffers,
        buffersData: !!buffersData,
        buffersDataFeatures: buffersData?.features?.length
      });
      
      if (isStations && stationsFeaturesRef.current?.buffers && stationsFeaturesRef.current.buffers.features && stationsFeaturesRef.current.buffers.features.length > 0) {
        console.log("Setting up buffers for stations layer", { 
          hasBuffers: !!stationsFeaturesRef.current.buffers,
          buffersCount: stationsFeaturesRef.current.buffers.features?.length,
          stationsCount: stationsFeaturesRef.current.stations.features?.length,
          firstStationId: stationsFeaturesRef.current.stations.features?.[0]?.id,
          firstBufferStationId: stationsFeaturesRef.current.buffers.features?.[0]?.properties?.stationId
        });
        
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
          console.log("Buffer graphics layer created and added to map");
        }
        
        const showBufferForStation = (graphic) => {
            if (!graphic || !bufferGraphicsRef.current) {
              console.log("showBufferForStation: missing graphic or bufferGraphicsRef", { graphic: !!graphic, bufferRef: !!bufferGraphicsRef.current });
              return;
            }
            
            bufferGraphicsRef.current.removeAll();
            
            const attrs = graphic.attributes || {};
            const objectId = attrs.__OBJECTID;
            const attrsId = attrs.id || attrs.ID;
            
            console.log("showBufferForStation:", { objectId, attrsId, attrs, stationsCount: stationsFeaturesRef.current?.stations?.features?.length, buffersCount: stationsFeaturesRef.current?.buffers?.features?.length });
            
            if (!stationsFeaturesRef.current?.stations?.features) {
              console.log("Missing stations features");
              return;
            }
            
            let stationFeature = null;
            let stationId = null;
            
            if (attrsId) {
              stationFeature = stationsFeaturesRef.current.stations.features.find(f => {
                const fid = f.id || f.properties?.id;
                return fid === attrsId || fid?.toString() === attrsId?.toString();
              });
              
              if (stationFeature) {
                stationId = stationFeature.id || stationFeature.properties?.id;
              } else {
                stationId = attrsId;
              }
            } else if (typeof objectId === "number" && stationsFeaturesRef.current.stations.features[objectId]) {
              stationFeature = stationsFeaturesRef.current.stations.features[objectId];
              stationId = stationFeature.id || stationFeature.properties?.id;
            } else if (graphic.geometry && graphic.geometry.type === "point") {
              const point = graphic.geometry;
              const lon = point.longitude || point.x;
              const lat = point.latitude || point.y;
              
              stationFeature = stationsFeaturesRef.current.stations.features.find(f => {
                if (f.geometry && f.geometry.type === "Point" && f.geometry.coordinates) {
                  const [fLon, fLat] = f.geometry.coordinates;
                  const tolerance = 0.0001;
                  return Math.abs(fLon - lon) < tolerance && Math.abs(fLat - lat) < tolerance;
                }
                return false;
              });
              
              if (stationFeature) {
                stationId = stationFeature.id || stationFeature.properties?.id;
              }
            }
            
            console.log("Found station feature:", stationFeature, "stationId:", stationId);
            
            if (stationId && stationsFeaturesRef.current.buffers?.features) {
              console.log("Searching for buffer with stationId:", stationId, "Total buffers:", stationsFeaturesRef.current.buffers.features.length);
              console.log("Sample buffer IDs:", stationsFeaturesRef.current.buffers.features.slice(0, 3).map(bf => ({
                id: bf.id,
                stationId: bf.properties?.stationId
              })));
              
              const bufferFeature = stationsFeaturesRef.current.buffers.features.find(
                bf => {
                  const bufferStationId = bf.properties?.stationId;
                  const bufferId = bf.id;
                  const match = bufferStationId === stationId || 
                               bufferStationId?.toString() === stationId?.toString() ||
                               bufferId === `buffer_${stationId}` || 
                               bufferId?.endsWith(String(stationId)) ||
                               bufferId?.includes(String(stationId)) ||
                               (bufferStationId && bufferStationId.toString() === stationId.toString());
                  if (match) {
                    console.log("Found buffer feature match:", { bufferId, bufferStationId, stationId, match });
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
              console.log("Could not find stationId or buffers:", { stationId, hasBuffers: !!stationsFeaturesRef.current.buffers?.features });
            }
        };
        
        const popupWatchHandle = viewRef.current.popup.watch("visible", (visible) => {
          console.log("Popup visibility changed:", visible, "selectedFeature:", viewRef.current.popup.selectedFeature, "isStations:", isStations);
          if (!visible && bufferGraphicsRef.current) {
            bufferGraphicsRef.current.removeAll();
            console.log("Buffers cleared on popup close");
          } else if (visible) {
            const selectedGraphic = viewRef.current.popup.selectedFeature || viewRef.current.popup.graphic;
            console.log("Popup opened with selectedFeature:", selectedGraphic, "layer:", selectedGraphic?.layer?.title, "current layer:", layer?.title, "layers match:", selectedGraphic?.layer === layer);
            if (selectedGraphic && selectedGraphic.layer === layer && isStations) {
              console.log("Showing buffer for station from popup");
              showBufferForStation(selectedGraphic);
            } else {
              console.log("Not showing buffer:", { hasGraphic: !!selectedGraphic, layerMatch: selectedGraphic?.layer === layer, isStations, selectedLayerTitle: selectedGraphic?.layer?.title, currentLayerTitle: layer?.title });
            }
          }
        });
        
        const clickHandle = viewRef.current.on("click", async (event) => {
          console.log("Map clicked");
          const result = await viewRef.current.hitTest(event);
          console.log("Hit test results:", result.results.map(r => ({ 
            hasGraphic: !!r.graphic, 
            layerTitle: r.graphic?.layer?.title,
            layerType: r.graphic?.layer?.type,
            currentLayerTitle: layer?.title,
            matches: r.graphic?.layer === layer
          })));
          const graphic = result.results.find(r => r.graphic?.layer === layer)?.graphic;
          console.log("Hit test result for stations layer:", graphic);
          if (graphic && isStations) {
            console.log("Showing buffer for station from click");
            showBufferForStation(graphic);
          } else if (!graphic && isStations) {
            console.log("No graphic found for stations layer in hit test, checking popup");
            setTimeout(() => {
              const popupGraphic = viewRef.current.popup.selectedFeature || viewRef.current.popup.graphic;
              if (popupGraphic && popupGraphic.layer === layer) {
                console.log("Found graphic from popup, showing buffer");
                showBufferForStation(popupGraphic);
              }
            }, 100);
          }
        });
        
        console.log("Event listeners attached for buffers");
      } else {
        console.log("Not setting up buffers:", { isStations, hasBuffers: !!stationsFeaturesRef.current?.buffers });
      }
    }).catch(err => {
      console.error("Layer load error:", err);
    });

    layerRef.current = layer;
    
    if (isStations) {
      stationsLayerRef.current = layer;
    } else if (isNeighborhoods) {
      neighborhoodsLayerRef.current = layer;
    }
    
    console.log("Adding layer to map:", { 
      title, 
      isStations, 
      isNeighborhoods,
      hasRef: !!stationsFeaturesRef.current, 
      hasBuffers: !!stationsFeaturesRef.current?.buffers,
      buffersCount: stationsFeaturesRef.current?.buffers?.features?.length 
    });
    
    viewRef.current.map.add(layer);
    console.log("Layer added to map, total layers:", viewRef.current.map.layers.length, "layer titles:", viewRef.current.map.layers.map(l => l.title));
    
    await layer.when();
    console.log("Layer ready, features count:", await layer.queryFeatureCount());
    
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

  const updateTransportFilters = useCallback((filters) => {
    currentFiltersRef.current = filters;
    if (layerRef.current && layerRef.current.type === "geojson") {
      const layerTitle = layerRef.current.title?.toLowerCase() || "";
      const isStationsLayer = layerTitle === "stations" || layerTitle.includes("station");
      
      if (isStationsLayer) {
        const definitionExpression = Object.entries(filters)
          .filter(([_, enabled]) => !enabled)
          .map(([type, _]) => `type <> '${type}'`)
          .join(" AND ");
        
        layerRef.current.definitionExpression = definitionExpression || "1=1";
        console.log("Updated definition expression for stations:", definitionExpression || "1=1");
      } else {
        layerRef.current.definitionExpression = null;
        console.log("Cleared definition expression for non-stations layer");
      }
    }
  }, []);

  const updateAdminLevelFilters = useCallback((filters) => {
    if (!filters) return;
    
    currentAdminLevelFiltersRef.current = filters;
    if (layerRef.current && layerRef.current.type === "geojson") {
      const layerTitle = layerRef.current.title?.toLowerCase() || "";
      const isNeighborhoodsLayer = layerTitle === "neighborhoods" || layerTitle.includes("neighborhood");
      
      if (isNeighborhoodsLayer) {
        const includedLevels = [];
        if (filters.level8 === true) includedLevels.push("8");
        if (filters.level9 === true) includedLevels.push("9");
        if (filters.level10 === true) includedLevels.push("10");
        
        console.log("updateAdminLevelFilters called:", { filters, includedLevels, layerTitle });
        
        if (includedLevels.length === 0) {
          layerRef.current.definitionExpression = "1=0";
          console.log("All admin levels disabled for neighborhoods");
        } else if (includedLevels.length === 3) {
          layerRef.current.definitionExpression = null;
          console.log("All admin levels enabled for neighborhoods");
        } else {
          const definitionExpression = `admin_level IN ('${includedLevels.join("','")}')`;
          layerRef.current.definitionExpression = definitionExpression;
          console.log("Updated definition expression for neighborhoods:", definitionExpression, "includedLevels:", includedLevels);
        }
      } else {
        layerRef.current.definitionExpression = null;
        console.log("Cleared definition expression for non-neighborhoods layer");
      }
    } else {
      console.log("No layer or wrong layer type:", { hasLayer: !!layerRef.current, layerType: layerRef.current?.type });
    }
  }, []);

  useEffect(() => {
    if (transportFilters) {
      currentFiltersRef.current = transportFilters;
      updateTransportFilters(transportFilters);
    }
  }, [transportFilters, updateTransportFilters]);

  useEffect(() => {
    if (adminLevelFilters) {
      currentAdminLevelFiltersRef.current = adminLevelFilters;
      updateAdminLevelFilters(adminLevelFilters);
    }
  }, [adminLevelFilters, updateAdminLevelFilters]);

  const calculateIntersections = useCallback(async (loadStationsCallback, loadNeighborhoodsCallback) => {
    if (!viewRef.current) {
      setStatus?.("Map is not ready");
      return;
    }

    try {
      setStatus?.("Loading data for intersections...");
      
      const [
        { default: geometryEngine },
        { default: GraphicsLayer },
        { default: Graphic },
        { default: SimpleFillSymbol },
        { default: SimpleLineSymbol },
        { default: SimpleMarkerSymbol }
      ] = await Promise.all([
        import("@arcgis/core/geometry/geometryEngine"),
        import("@arcgis/core/layers/GraphicsLayer"),
        import("@arcgis/core/Graphic"),
        import("@arcgis/core/symbols/SimpleFillSymbol"),
        import("@arcgis/core/symbols/SimpleLineSymbol"),
        import("@arcgis/core/symbols/SimpleMarkerSymbol")
      ]);

      if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.buffers || !stationsFeaturesRef.current.stations) {
        setStatus?.("Loading stations...");
        if (loadStationsCallback) {
          await loadStationsCallback();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.buffers || !stationsFeaturesRef.current.stations) {
          setStatus?.("Failed to load stations. Please try loading stations manually first.");
          return;
        }
      }

      let neighborhoodsLayer = neighborhoodsLayerRef.current;
      
      if (!neighborhoodsLayer) {
        setStatus?.("Loading neighborhoods...");
        if (loadNeighborhoodsCallback) {
          await loadNeighborhoodsCallback();
          await new Promise(resolve => setTimeout(resolve, 1000));
          neighborhoodsLayer = neighborhoodsLayerRef.current;
        }
        
        if (!neighborhoodsLayer) {
          setStatus?.("Failed to load neighborhoods. Please try loading neighborhoods manually first.");
          return;
        }
      }

      if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.buffers || !stationsFeaturesRef.current.stations) {
        setStatus?.("Stations data is missing. Please reload stations.");
        return;
      }

      const buffers = stationsFeaturesRef.current.buffers;
      const stations = stationsFeaturesRef.current.stations;
      
      if (!buffers || !buffers.features || buffers.features.length === 0) {
        setStatus?.("No buffers found");
        return;
      }
      
      if (!stations || !stations.features || stations.features.length === 0) {
        setStatus?.("No stations found");
        return;
      }

      const jsonUtilsModule = await import("@arcgis/core/geometry/support/jsonUtils");
      const jsonUtils = jsonUtilsModule.default || jsonUtilsModule;
      
      if (!highlightGraphicsLayerRef.current) {
        const highlightLayer = new GraphicsLayer({ title: "Intersection Highlights" });
        viewRef.current.map.add(highlightLayer);
        highlightGraphicsLayerRef.current = highlightLayer;
      } else {
        highlightGraphicsLayerRef.current.removeAll();
      }

      if (neighborhoodClickHandlerRef.current) {
        if (typeof neighborhoodClickHandlerRef.current === "function") {
          neighborhoodClickHandlerRef.current();
        } else if (neighborhoodClickHandlerRef.current && typeof neighborhoodClickHandlerRef.current.remove === "function") {
          neighborhoodClickHandlerRef.current.remove();
        } else if (viewRef.current && typeof viewRef.current.off === "function") {
          viewRef.current.off("click", neighborhoodClickHandlerRef.current);
        }
        neighborhoodClickHandlerRef.current = null;
      }

      console.log("Setting up click handler for neighborhoods layer:", {
        hasLayer: !!neighborhoodsLayer,
        layerTitle: neighborhoodsLayer?.title,
        layerType: neighborhoodsLayer?.type
      });

      const clickHandler = async (event) => {
        console.log("View clicked, checking for neighborhoods layer");
        
        const geometryEngineModule = await import("@arcgis/core/geometry/geometryEngine");
        const geometryEngine = geometryEngineModule.default || geometryEngineModule;
        
        if (!geometryEngine || typeof geometryEngine.intersects !== "function") {
          console.error("geometryEngine not available or missing intersects method", geometryEngine);
          setStatus?.("Error: Geometry engine not available");
          return;
        }
        
        const hitTestResult = await viewRef.current.hitTest(event);
        const neighborhoodGraphic = hitTestResult.results.find(
          r => r.graphic?.layer === neighborhoodsLayer
        )?.graphic;
        
        if (!neighborhoodGraphic) {
          console.log("Click was not on neighborhoods layer");
          return;
        }
        
        console.log("Neighborhoods layer clicked!", {
          graphic: neighborhoodGraphic,
          hasGraphic: !!neighborhoodGraphic,
          graphicGeometry: neighborhoodGraphic.geometry
        });
        
        const clickedGraphic = neighborhoodGraphic;
        if (!clickedGraphic || !clickedGraphic.geometry) {
          console.warn("No graphic or geometry");
          return;
        }

        if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.buffers || !stationsFeaturesRef.current.stations) {
          setStatus?.("Stations data is missing. Please reload stations.");
          return;
        }

        const currentBuffers = stationsFeaturesRef.current.buffers;
        const currentStations = stationsFeaturesRef.current.stations;

        if (!currentBuffers?.features || currentBuffers.features.length === 0) {
          setStatus?.("No buffers available");
          return;
        }

        if (!currentStations?.features || currentStations.features.length === 0) {
          setStatus?.("No stations available");
          return;
        }

        const neighborhoodGeometry = clickedGraphic.geometry;
        const neighborhoodAttrs = clickedGraphic.attributes || {};
        
        if (!highlightGraphicsLayerRef.current) {
          setStatus?.("Highlight layer not initialized");
          return;
        }

        highlightGraphicsLayerRef.current.removeAll();
        
        if (bufferGraphicsRef.current && viewRef.current?.map) {
          viewRef.current.map.remove(bufferGraphicsRef.current);
          bufferGraphicsRef.current = null;
        }
        
        const neighborhoodHighlight = new Graphic({
          geometry: neighborhoodGeometry,
          symbol: new SimpleFillSymbol({
            color: [255, 255, 0, 0.4],
            outline: new SimpleLineSymbol({
              color: [255, 200, 0],
              width: 3
            })
          })
        });
        highlightGraphicsLayerRef.current.add(neighborhoodHighlight);

        const intersectingStations = [];
        const intersectingBuffers = [];

        console.log("Checking intersections:", {
          buffersCount: currentBuffers.features.length,
          stationsCount: currentStations.features.length,
          neighborhoodName: neighborhoodAttrs.name,
          sampleBufferIds: currentBuffers.features.slice(0, 3).map(bf => ({
            id: bf.id,
            stationId: bf.properties?.stationId
          })),
          sampleStationIds: currentStations.features.slice(0, 3).map(sf => ({
            id: sf.id,
            propertiesId: sf.properties?.id
          }))
        });

        let checkedCount = 0;
        let intersectionCount = 0;

        for (let i = 0; i < currentBuffers.features.length; i++) {
          const bufferFeature = currentBuffers.features[i];
          if (!bufferFeature.geometry) continue;

          try {
            checkedCount++;
            let bufferGeometry;
            if (jsonUtils && typeof jsonUtils.fromGeoJSON === "function") {
              bufferGeometry = jsonUtils.fromGeoJSON(bufferFeature.geometry);
            } else if (jsonUtils && jsonUtils.default && typeof jsonUtils.default.fromGeoJSON === "function") {
              bufferGeometry = jsonUtils.default.fromGeoJSON(bufferFeature.geometry);
            } else {
              const { default: Polygon } = await import("@arcgis/core/geometry/Polygon");
              
              if (bufferFeature.geometry.type === "Polygon") {
                bufferGeometry = Polygon.fromJSON({
                  rings: bufferFeature.geometry.coordinates,
                  spatialReference: { wkid: 4326 }
                });
              } else {
                console.warn("Unsupported buffer geometry type:", bufferFeature.geometry.type);
                continue;
              }
            }
            
            if (!bufferGeometry) {
              console.warn("Failed to convert buffer geometry:", i);
              continue;
            }

            const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
            
            if (intersects) {
              intersectionCount++;
              const bufferProps = bufferFeature.properties || {};
              const stationId = bufferProps.stationId || bufferFeature.id?.replace("buffer_", "");
              
              console.log("Found intersecting buffer:", {
                bufferIndex: i,
                stationId,
                bufferId: bufferFeature.id,
                bufferProps,
                stationIdFromProps: bufferProps.stationId,
                stationIdFromId: bufferFeature.id?.replace("buffer_", "")
              });
              
              const stationFeature = currentStations.features.find(
                f => {
                  const fId = f.id || f.properties?.id;
                  const matches = String(fId) === String(stationId);
                  if (matches) {
                    console.log("Matched station:", {
                      fId,
                      stationId,
                      stationName: f.properties?.name,
                      stationFeature: f
                    });
                  }
                  return matches;
                }
              );

              if (!stationFeature) {
                console.warn("Station not found for buffer:", {
                  stationId,
                  searchedIn: currentStations.features.length,
                  sampleIds: currentStations.features.slice(0, 5).map(f => ({
                    id: f.id,
                    propsId: f.properties?.id
                  }))
                });
              }

              if (stationFeature && stationFeature.geometry) {
                let stationPoint;
                if (jsonUtils && typeof jsonUtils.fromGeoJSON === "function") {
                  stationPoint = jsonUtils.fromGeoJSON(stationFeature.geometry);
                } else if (jsonUtils && jsonUtils.default && typeof jsonUtils.default.fromGeoJSON === "function") {
                  stationPoint = jsonUtils.default.fromGeoJSON(stationFeature.geometry);
                } else {
                  const { default: Point } = await import("@arcgis/core/geometry/Point");
                  stationPoint = Point.fromJSON({
                    x: stationFeature.geometry.coordinates[0],
                    y: stationFeature.geometry.coordinates[1],
                    spatialReference: { wkid: 4326 }
                  });
                }
                
                if (stationPoint) {
                  intersectingStations.push({
                    graphic: new Graphic({
                      geometry: stationPoint,
                      symbol: new SimpleMarkerSymbol({
                        color: [255, 0, 0],
                        size: 14,
                        outline: {
                          color: [255, 255, 255],
                          width: 3
                        }
                      })
                    }),
                    station: stationFeature
                  });
                  console.log("Added intersecting station:", stationFeature.properties?.name);
                } else {
                  console.warn("Failed to convert station point");
                }
              }

              const bufferGraphic = new Graphic({
                geometry: bufferGeometry,
                symbol: new SimpleFillSymbol({
                  color: [255, 165, 0, 0.4],
                  outline: new SimpleLineSymbol({
                    color: [255, 140, 0],
                    width: 3
                  })
                })
              });
              intersectingBuffers.push(bufferGraphic);
            }
          } catch (err) {
            console.error("Error checking intersection:", err, "at buffer index:", i);
          }
        }

        console.log("Intersection check complete:", {
          checkedBuffers: checkedCount,
          foundIntersections: intersectionCount,
          intersectingStationsCount: intersectingStations.length,
          intersectingBuffersCount: intersectingBuffers.length
        });

        console.log("Intersection results:", {
          intersectingStationsCount: intersectingStations.length,
          intersectingBuffersCount: intersectingBuffers.length
        });

        intersectingBuffers.forEach(buffer => {
          highlightGraphicsLayerRef.current.add(buffer);
        });

        intersectingStations.forEach(item => {
          highlightGraphicsLayerRef.current.add(item.graphic);
        });

        const stationNames = intersectingStations.length > 0
          ? intersectingStations
              .map(item => item.station.properties?.name || item.station.properties?.stationName || "Unknown")
              .join(", ")
          : "None";
        
        setStatus?.(
          `Neighborhood: ${neighborhoodAttrs.name || "Unknown"} - ` +
          `${intersectingStations.length} intersecting station(s): ${stationNames}`
        );
      };

      if (viewRef.current && neighborhoodsLayer) {
        if (neighborhoodClickHandlerRef.current) {
          if (typeof neighborhoodClickHandlerRef.current === "function") {
            neighborhoodClickHandlerRef.current();
          } else if (neighborhoodClickHandlerRef.current && typeof neighborhoodClickHandlerRef.current.remove === "function") {
            neighborhoodClickHandlerRef.current.remove();
          } else if (typeof viewRef.current.off === "function") {
            viewRef.current.off("click", neighborhoodClickHandlerRef.current);
          }
        }
        
        const handlerHandle = viewRef.current.on("click", clickHandler);
        neighborhoodClickHandlerRef.current = handlerHandle;
        console.log("Click handler registered on view for neighborhoods layer", {
          handlerType: typeof handlerHandle,
          hasRemove: typeof handlerHandle?.remove === "function"
        });
        setStatus?.("Click on a neighborhood to see intersecting stations. Intersection mode active.");
      } else {
        console.error("Cannot register click handler - view or layer missing");
        setStatus?.("Error: Cannot set up click handler");
      }
      
    } catch (err) {
      console.error("Error setting up intersections:", err);
      setStatus?.(`Error: ${err.message}`);
    }
  }, []);

  return { mapRef, addGeoJsonLayer, goToBbox, updateTransportFilters, updateAdminLevelFilters, calculateIntersections };
}
