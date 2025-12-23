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
  const neighborhoodsFeaturesRef = useRef(null);
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
      const oldLayerTitle = layerRef.current.title?.toLowerCase() || "";
      const oldIsStations = oldLayerTitle === "stations" || oldLayerTitle.includes("station");
      const oldIsNeighborhoods = oldLayerTitle === "neighborhoods" || oldLayerTitle.includes("neighborhood");
      
      if ((isStations && oldIsStations) || (isNeighborhoods && oldIsNeighborhoods)) {
        console.log("Removing old layer of same type:", layerRef.current.title);
        viewRef.current.map.remove(layerRef.current);
        layerRef.current = null;
      } else {
        console.log("Keeping old layer of different type:", layerRef.current.title);
      }
    }
    
    if (isStations && stationsLayerRef.current && viewRef.current?.map && stationsLayerRef.current !== layerRef.current) {
      console.log("Removing old stations layer:", stationsLayerRef.current.title);
      viewRef.current.map.remove(stationsLayerRef.current);
      stationsLayerRef.current = null;
    }
    
    if (isNeighborhoods && neighborhoodsLayerRef.current && viewRef.current?.map && neighborhoodsLayerRef.current !== layerRef.current) {
      console.log("Removing old neighborhoods layer:", neighborhoodsLayerRef.current.title);
      viewRef.current.map.remove(neighborhoodsLayerRef.current);
      neighborhoodsLayerRef.current = null;
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
    
    if (isNeighborhoods) {
      neighborhoodsFeaturesRef.current = prepared;
    }
    
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
    
    const includedLevels = [];
    if (filters.level8 === true) includedLevels.push("8");
    if (filters.level9 === true) includedLevels.push("9");
    if (filters.level10 === true) includedLevels.push("10");
    
    const definitionExpression = includedLevels.length === 0 
      ? "1=0"
      : includedLevels.length === 3
        ? null
        : `admin_level IN ('${includedLevels.join("','")}')`;
    
    // Apply to neighborhoods layer (could be regular or heatmap)
    if (neighborhoodsLayerRef.current && neighborhoodsLayerRef.current.type === "geojson") {
      neighborhoodsLayerRef.current.definitionExpression = definitionExpression;
      console.log("Updated admin level filter for neighborhoods layer:", {
        layerTitle: neighborhoodsLayerRef.current.title,
        definitionExpression,
        includedLevels
      });
    }
    
    // Also apply to layerRef if it's a neighborhoods layer
    if (layerRef.current && layerRef.current.type === "geojson") {
      const layerTitle = layerRef.current.title?.toLowerCase() || "";
      const isNeighborhoodsLayer = layerTitle === "neighborhoods" || layerTitle.includes("neighborhood");
      
      if (isNeighborhoodsLayer) {
        layerRef.current.definitionExpression = definitionExpression;
        console.log("Updated admin level filter for layerRef:", {
          layerTitle: layerRef.current.title,
          definitionExpression,
          includedLevels
        });
      }
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

  const calculateNeighborhoodCoverage = useCallback(async (neighborhoodGeometry, neighborhoodAttrs) => {
    if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.stations) {
      return 0;
    }

    const stations = stationsFeaturesRef.current.stations;
    const geometryEngineModule = await import("@arcgis/core/geometry/geometryEngine");
    const geometryEngine = geometryEngineModule.default || geometryEngineModule;
    const { default: Point } = await import("@arcgis/core/geometry/Point");
    const { default: Query } = await import("@arcgis/core/rest/support/Query");
    const MAX_BUFFER_RADIUS = 500;

    const intersectingGeometries = [];

    try {
      const expandedNeighborhood = geometryEngine.geodesicBuffer(neighborhoodGeometry, MAX_BUFFER_RADIUS, "meters");
      const query = new Query();
      query.geometry = expandedNeighborhood;
      query.spatialRelationship = "intersects";
      query.returnGeometry = true;
      query.outFields = ["*"];
      
      if (!stationsLayerRef.current) return 0;
      const { features } = await stationsLayerRef.current.queryFeatures(query);
      
      for (const feature of features) {
        const stationId = feature.attributes?.id;
        if (!stationId) continue;
        
        const stationGeoJSON = stations.features.find(s => 
          (s.id === stationId) || (s.properties?.id === stationId)
        );
        
        if (!stationGeoJSON || !stationGeoJSON.geometry) continue;
        
        const bufferRadius = stationGeoJSON.properties?.bufferRadius || 400;
        const coords = stationGeoJSON.geometry.coordinates;
        
        const stationPoint = new Point({
          longitude: coords[0],
          latitude: coords[1],
          spatialReference: neighborhoodGeometry.spatialReference || { wkid: 4326 }
        });
        
        try {
          const bufferGeometry = geometryEngine.geodesicBuffer(stationPoint, bufferRadius, "meters");
          if (!bufferGeometry) continue;
          
          const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
          if (intersects) {
            try {
              const intersection = geometryEngine.intersect(bufferGeometry, neighborhoodGeometry);
              if (intersection && intersection.type && (intersection.rings || intersection.paths)) {
                intersectingGeometries.push(intersection);
              }
            } catch (intersectErr) {
              // Ignore intersection errors
            }
          }
        } catch (bufferErr) {
          // Ignore buffer errors
        }
      }
    } catch (queryErr) {
      // Fallback to checking all stations
      for (let i = 0; i < stations.features.length; i++) {
        const stationFeature = stations.features[i];
        if (!stationFeature.geometry || stationFeature.geometry.type !== "Point") continue;

        try {
          const stationId = stationFeature.id || stationFeature.properties?.id;
          const bufferRadius = stationFeature.properties?.bufferRadius || 400;
          
          if (!stationId) continue;

          const coords = stationFeature.geometry.coordinates;
          const stationPoint = new Point({
            longitude: coords[0],
            latitude: coords[1],
            spatialReference: neighborhoodGeometry.spatialReference || { wkid: 4326 }
          });

          const bufferGeometry = geometryEngine.geodesicBuffer(stationPoint, bufferRadius, "meters");
          if (!bufferGeometry) continue;
          
          const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
          
          if (intersects) {
            try {
              const intersection = geometryEngine.intersect(bufferGeometry, neighborhoodGeometry);
              if (intersection && intersection.type && (intersection.rings || intersection.paths)) {
                intersectingGeometries.push(intersection);
              }
            } catch (intersectErr) {
              // Ignore
            }
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    if (intersectingGeometries.length === 0) {
      return 0;
    }

    try {
      // Try to union all at once first
      let unionGeometry;
      try {
        if (intersectingGeometries.length === 1) {
          unionGeometry = intersectingGeometries[0];
        } else {
          // Try union with array
          unionGeometry = geometryEngine.union(intersectingGeometries);
          if (!unionGeometry) {
            throw new Error("Union with array returned null");
          }
        }
      } catch (unionArrayErr) {
        // Fallback to incremental union
        unionGeometry = intersectingGeometries[0];
        for (let i = 1; i < intersectingGeometries.length; i++) {
          const newUnion = geometryEngine.union(unionGeometry, intersectingGeometries[i]);
          if (newUnion) {
            const oldArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
            const newArea = geometryEngine.geodesicArea(newUnion, "square-meters");
            if (newArea >= oldArea) {
              unionGeometry = newUnion;
            }
          }
        }
      }
      
      const neighborhoodArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
      const coverageArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
      
      if (neighborhoodArea > 0 && coverageArea > 0) {
        const percentage = (coverageArea / neighborhoodArea) * 100;
        // Clamp to 0-100%
        return Math.min(100, Math.max(0, percentage));
      }
    } catch (areaErr) {
      console.warn("Error calculating coverage:", areaErr);
    }

    return 0;
  }, []);

  const setupNeighborhoodClickFilter = useCallback(async () => {
    if (!viewRef.current || !stationsLayerRef.current || !neighborhoodsLayerRef.current) {
      return;
    }

    if (neighborhoodClickHandlerRef.current) {
      if (typeof neighborhoodClickHandlerRef.current === "function") {
        neighborhoodClickHandlerRef.current();
      } else if (neighborhoodClickHandlerRef.current && typeof neighborhoodClickHandlerRef.current.remove === "function") {
        neighborhoodClickHandlerRef.current.remove();
      }
      neighborhoodClickHandlerRef.current = null;
    }

    const neighborhoodsLayer = neighborhoodsLayerRef.current;
    const stationsLayer = stationsLayerRef.current;

    const clickHandler = async (event) => {
      event.stopPropagation();
      
      const hitTestResult = await viewRef.current.hitTest(event);
      
      const neighborhoodGraphic = hitTestResult.results.find(
        r => r.graphic?.layer === neighborhoodsLayer
      )?.graphic;
      
      const stationsGraphic = hitTestResult.results.find(
        r => r.graphic?.layer === stationsLayer
      )?.graphic;
      
      if (!neighborhoodGraphic || !neighborhoodGraphic.geometry) {
        console.log("Click was not on neighborhoods layer, ignoring");
        return;
      }

      if (stationsGraphic) {
        console.log("Click is on both layers, prioritizing neighborhoods filtering");
      }

      console.log("Neighborhood clicked, filtering stations");
      
      const geometryEngineModule = await import("@arcgis/core/geometry/geometryEngine");
      const geometryEngine = geometryEngineModule.default || geometryEngineModule;
      
      if (!geometryEngine || typeof geometryEngine.intersects !== "function") {
        console.error("geometryEngine not available");
        return;
      }

      const neighborhoodGeometry = neighborhoodGraphic.geometry;
      const neighborhoodAttrs = neighborhoodGraphic.attributes || {};
      
      if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.stations) {
        setStatus?.("Stations data is missing. Please reload stations.");
        return;
      }

      const stations = stationsFeaturesRef.current.stations;
      const intersectingStationIds = new Set();
      let coveragePercentage = 0;

      console.log("Filtering stations for neighborhood (including buffers):", {
        neighborhoodName: neighborhoodAttrs.name,
        stationsCount: stations.features.length,
        neighborhoodSR: neighborhoodGeometry.spatialReference?.wkid
      });

      const { default: Point } = await import("@arcgis/core/geometry/Point");
      const { default: Query } = await import("@arcgis/core/rest/support/Query");
      const MAX_BUFFER_RADIUS = 500;

      try {
        const expandedNeighborhood = geometryEngine.geodesicBuffer(neighborhoodGeometry, MAX_BUFFER_RADIUS, "meters");
        
        const query = new Query();
        query.geometry = expandedNeighborhood;
        query.spatialRelationship = "intersects";
        query.returnGeometry = true;
        query.outFields = ["*"];
        
        const { features } = await stationsLayer.queryFeatures(query);
        
        console.log("Query returned", features.length, "potentially intersecting stations (within", MAX_BUFFER_RADIUS, "m of neighborhood)");
        
        const intersectingGeometries = [];
        
        for (const feature of features) {
          const stationId = feature.attributes?.id;
          if (!stationId) continue;
          
          const stationGeoJSON = stations.features.find(s => 
            (s.id === stationId) || (s.properties?.id === stationId)
          );
          
          if (!stationGeoJSON || !stationGeoJSON.geometry) continue;
          
          const bufferRadius = stationGeoJSON.properties?.bufferRadius || 400;
          const coords = stationGeoJSON.geometry.coordinates;
          
          const stationPoint = new Point({
            longitude: coords[0],
            latitude: coords[1],
            spatialReference: neighborhoodGeometry.spatialReference || { wkid: 4326 }
          });
          
          try {
            const bufferGeometry = geometryEngine.geodesicBuffer(stationPoint, bufferRadius, "meters");
            if (!bufferGeometry) continue;
            
            const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
            if (intersects) {
              intersectingStationIds.add(String(stationId));
              
              if (intersectingStationIds.size <= 3) {
                console.log("Testing intersection calculation for station", stationId, {
                  bufferType: bufferGeometry.type,
                  bufferSR: bufferGeometry.spatialReference?.wkid,
                  neighborhoodType: neighborhoodGeometry.type,
                  neighborhoodSR: neighborhoodGeometry.spatialReference?.wkid,
                  hasIntersectsMethod: typeof geometryEngine.intersect === "function"
                });
              }
              
              try {
                const intersection = geometryEngine.intersect(bufferGeometry, neighborhoodGeometry);
                
                if (intersectingStationIds.size <= 3) {
                  console.log("Intersection result for station", stationId, {
                    hasResult: !!intersection,
                    type: intersection?.type,
                    hasRings: !!intersection?.rings,
                    ringsCount: intersection?.rings?.length,
                    hasPaths: !!intersection?.paths,
                    isEmpty: intersection?.isEmpty,
                    spatialReference: intersection?.spatialReference?.wkid,
                    toString: intersection?.toString?.()
                  });
                }
                
                if (intersection) {
                  const hasRings = intersection.rings && Array.isArray(intersection.rings) && intersection.rings.length > 0;
                  const hasPaths = intersection.paths && Array.isArray(intersection.paths) && intersection.paths.length > 0;
                  const hasType = intersection.type && typeof intersection.type === "string";
                  
                  if (hasType && (hasRings || hasPaths)) {
                    intersectingGeometries.push(intersection);
                    if (intersectingGeometries.length <= 5) {
                      console.log("✓ Added intersection geometry for station", stationId, {
                        type: intersection.type,
                        hasRings,
                        ringsCount: intersection.rings?.length,
                        hasPaths,
                        pathsCount: intersection.paths?.length
                      });
                    }
                  } else {
                    if (intersectingStationIds.size <= 5) {
                      console.warn("Intersection invalid structure for station", stationId, {
                        hasType,
                        hasRings,
                        hasPaths,
                        type: intersection.type,
                        keys: Object.keys(intersection)
                      });
                    }
                  }
                } else {
                  if (intersectingStationIds.size <= 3) {
                    console.warn("Intersection is null/undefined for station", stationId);
                  }
                }
              } catch (intersectErr) {
                console.error("Error calculating intersection for station", stationId, intersectErr);
                if (intersectingStationIds.size <= 3) {
                  console.error("Error details:", {
                    message: intersectErr.message,
                    stack: intersectErr.stack,
                    name: intersectErr.name
                  });
                }
              }
            }
          } catch (bufferErr) {
            console.warn("Error checking buffer for station", stationId, bufferErr);
          }
        }
        
        console.log("After buffer check, found", intersectingStationIds.size, "stations with intersecting buffers");
        console.log("Intersecting geometries count:", intersectingGeometries.length);
        
        if (intersectingGeometries.length > 0) {
          try {
            let unionGeometry;
            
            if (intersectingGeometries.length === 1) {
              unionGeometry = intersectingGeometries[0];
            } else {
              try {
                unionGeometry = geometryEngine.union(intersectingGeometries);
                if (!unionGeometry) {
                  throw new Error("Union with array returned null");
                }
              } catch (unionArrayErr) {
                // Fallback to incremental union with area validation
                unionGeometry = intersectingGeometries[0];
                for (let i = 1; i < intersectingGeometries.length; i++) {
                  const newUnion = geometryEngine.union(unionGeometry, intersectingGeometries[i]);
                  if (newUnion) {
                    const oldArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
                    const newArea = geometryEngine.geodesicArea(newUnion, "square-meters");
                    if (newArea >= oldArea) {
                      unionGeometry = newUnion;
                    }
                  }
                }
              }
            }
            
            const neighborhoodArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
            const coverageArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
            
            if (neighborhoodArea > 0 && coverageArea > 0) {
              coveragePercentage = Math.min(100, Math.max(0, (coverageArea / neighborhoodArea) * 100));
            }
          } catch (areaErr) {
            console.error("Error calculating coverage area:", areaErr);
          }
        }
      } catch (queryErr) {
        console.error("Error querying stations layer:", queryErr);
        
        console.log("Falling back to checking all stations...");
        
        let checkedCount = 0;
        let intersectionCount = 0;
        const intersectingGeometries = [];

        for (let i = 0; i < stations.features.length; i++) {
          const stationFeature = stations.features[i];
          if (!stationFeature.geometry || stationFeature.geometry.type !== "Point") continue;

          try {
            checkedCount++;
            const stationId = stationFeature.id || stationFeature.properties?.id;
            const bufferRadius = stationFeature.properties?.bufferRadius || 400;
            
            if (!stationId) continue;

            const coords = stationFeature.geometry.coordinates;
            const stationPoint = new Point({
              longitude: coords[0],
              latitude: coords[1],
              spatialReference: neighborhoodGeometry.spatialReference || { wkid: 4326 }
            });

            const bufferGeometry = geometryEngine.geodesicBuffer(stationPoint, bufferRadius, "meters");
            if (!bufferGeometry) continue;
            
            const intersects = geometryEngine.intersects(bufferGeometry, neighborhoodGeometry);
            
            if (intersects) {
              intersectionCount++;
              intersectingStationIds.add(String(stationId));
              try {
                const intersection = geometryEngine.intersect(bufferGeometry, neighborhoodGeometry);
                if (intersection && intersection.type && (intersection.rings || intersection.paths)) {
                  intersectingGeometries.push(intersection);
                  if (checkedCount <= 5) {
                    console.log("Added intersection geometry (fallback) for station", stationId, {
                      type: intersection.type
                    });
                  }
                } else {
                  if (checkedCount <= 5) {
                    console.warn("Intersection is invalid (fallback) for station", stationId);
                  }
                }
              } catch (intersectErr) {
                if (checkedCount <= 5) {
                  console.error("Error calculating intersection for station", stationId, intersectErr);
                }
              }
            }
          } catch (err) {
            if (checkedCount <= 5) {
              console.error("Error checking station:", err);
            }
          }
        }
        
        console.log("Fallback check complete:", {
          checkedStations: checkedCount,
          foundIntersections: intersectionCount,
          intersectingGeometriesCount: intersectingGeometries.length
        });
        
        if (intersectingGeometries.length > 0) {
          try {
            let unionGeometry;
            
            if (intersectingGeometries.length === 1) {
              unionGeometry = intersectingGeometries[0];
            } else {
              try {
                unionGeometry = geometryEngine.union(intersectingGeometries);
                if (!unionGeometry) {
                  throw new Error("Union with array returned null");
                }
              } catch (unionArrayErr) {
                // Fallback to incremental union with area validation
                unionGeometry = intersectingGeometries[0];
                for (let i = 1; i < intersectingGeometries.length; i++) {
                  const newUnion = geometryEngine.union(unionGeometry, intersectingGeometries[i]);
                  if (newUnion) {
                    const oldArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
                    const newArea = geometryEngine.geodesicArea(newUnion, "square-meters");
                    if (newArea >= oldArea) {
                      unionGeometry = newUnion;
                    }
                  }
                }
              }
            }
            
            const neighborhoodArea = geometryEngine.geodesicArea(neighborhoodGeometry, "square-meters");
            const coverageArea = geometryEngine.geodesicArea(unionGeometry, "square-meters");
            
            if (neighborhoodArea > 0 && coverageArea > 0) {
              coveragePercentage = Math.min(100, Math.max(0, (coverageArea / neighborhoodArea) * 100));
            }
          } catch (areaErr) {
            console.error("Error calculating coverage area (fallback):", areaErr);
          }
        }
      }

      console.log("Intersecting station IDs:", Array.from(intersectingStationIds));
      console.log("Final coverage percentage:", coveragePercentage);

      if (intersectingStationIds.size > 0) {
        const stationIdsArray = Array.from(intersectingStationIds);
        const definitionExpression = `id IN ('${stationIdsArray.join("','")}')`;
        console.log("Setting definition expression:", definitionExpression, {
          stationIdsArray: stationIdsArray.slice(0, 5),
          totalIds: stationIdsArray.length,
          layerTitle: stationsLayer.title
        });
        
        stationsLayer.definitionExpression = definitionExpression;
        
        setTimeout(async () => {
          const count = await stationsLayer.queryFeatureCount();
          console.log("Station count after filtering:", count);
        }, 100);
        
        const population = neighborhoodAttrs.population || neighborhoodAttrs.POPULATION || 0;
        const populationNum = typeof population === "number" ? population : Number(population) || 0;
        const uncoveredPopulation = populationNum > 0 && coveragePercentage > 0 
          ? Math.round(populationNum * (1 - coveragePercentage / 100))
          : null;
        
        let coverageText = ` (${coveragePercentage.toFixed(2)}% coverage)`;
        if (uncoveredPopulation !== null && uncoveredPopulation >= 0) {
          coverageText += ` - ${uncoveredPopulation} people need coverage`;
        }
        
        console.log("Status message:", `Showing ${stationIdsArray.length} stations intersecting with ${neighborhoodAttrs.name || "neighborhood"}${coverageText}`);
        setStatus?.(`Showing ${stationIdsArray.length} stations intersecting with ${neighborhoodAttrs.name || "neighborhood"}${coverageText}`);
      } else {
        console.log("No intersecting stations found");
        stationsLayer.definitionExpression = "1=0";
        setStatus?.(`No stations intersect with ${neighborhoodAttrs.name || "neighborhood"}`);
      }
    };

    if (viewRef.current && neighborhoodsLayer) {
      const handlerHandle = viewRef.current.on("click", clickHandler);
      neighborhoodClickHandlerRef.current = handlerHandle;
    }
  }, []);

  const showAccessibilityHeatmap = useCallback(async () => {
    if (!neighborhoodsLayerRef.current || !stationsLayerRef.current || !viewRef.current) {
      setStatus?.("Neighborhoods and stations layers must be loaded first.");
      return;
    }

    if (!stationsFeaturesRef.current || !stationsFeaturesRef.current.stations) {
      setStatus?.("Stations data is missing. Please load stations first.");
      return;
    }

    setStatus?.("Calculating accessibility coverage for neighborhoods...");

    // Remove click handler if exists
    if (neighborhoodClickHandlerRef.current) {
      if (typeof neighborhoodClickHandlerRef.current === "function") {
        neighborhoodClickHandlerRef.current();
      } else if (neighborhoodClickHandlerRef.current && typeof neighborhoodClickHandlerRef.current.remove === "function") {
        neighborhoodClickHandlerRef.current.remove();
      }
      neighborhoodClickHandlerRef.current = null;
    }

    // Reset stations layer filter to show all stations
    if (stationsLayerRef.current) {
      stationsLayerRef.current.definitionExpression = null;
      console.log("Reset stations layer filter to show all stations for heatmap");
    }

    try {
      const neighborhoodsLayer = neighborhoodsLayerRef.current;
      const { default: Query } = await import("@arcgis/core/rest/support/Query");

      const query = new Query();
      query.where = "1=1";
      query.returnGeometry = true;
      query.outFields = ["*"];

      const { features } = await neighborhoodsLayer.queryFeatures(query);
      
      console.log("Calculating coverage for", features.length, "neighborhoods");

      const coverageData = [];
      
      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        const coverage = await calculateNeighborhoodCoverage(feature.geometry, feature.attributes);
        coverageData.push({
          objectId: feature.attributes.OBJECTID || feature.attributes.__OBJECTID || i,
          coverage: coverage
        });
        
        if ((i + 1) % 10 === 0) {
          setStatus?.(`Calculating coverage: ${i + 1}/${features.length} neighborhoods...`);
        }
      }

      // Get original neighborhoods GeoJSON
      if (!neighborhoodsFeaturesRef.current) {
        setStatus?.("Neighborhoods data not found. Please reload neighborhoods.");
        return;
      }

      const originalGeoJSON = neighborhoodsFeaturesRef.current;
      
      // Create a map: index from queryFeatures -> coverage
      const indexToCoverageMap = new Map();
      for (let i = 0; i < coverageData.length; i++) {
        indexToCoverageMap.set(i, coverageData[i].coverage);
      }
      
      // Also create a map by feature ID for matching
      const idToCoverageMap = new Map();
      for (let i = 0; i < features.length && i < coverageData.length; i++) {
        const feature = features[i];
        const featureId = feature.attributes.id || feature.attributes.ID || feature.properties?.id;
        if (featureId) {
          idToCoverageMap.set(String(featureId), coverageData[i].coverage);
        }
      }

      // Create updated GeoJSON with coverage
      const updatedGeoJSON = {
        type: "FeatureCollection",
        features: originalGeoJSON.features.map((feature, index) => {
          // Try to match by ID first, then by index
          const featureId = feature.id || feature.properties?.id;
          let coverage = 0;
          
          if (featureId && idToCoverageMap.has(String(featureId))) {
            coverage = idToCoverageMap.get(String(featureId));
          } else if (indexToCoverageMap.has(index)) {
            coverage = indexToCoverageMap.get(index);
          }
          
          if (index < 10) {
            console.log(`Feature ${index} coverage:`, {
              featureId,
              propsId: feature.properties?.id,
              coverage,
              matchedById: featureId && idToCoverageMap.has(String(featureId)),
              matchedByIndex: indexToCoverageMap.has(index)
            });
          }
          
          // Ensure admin_level is preserved
          const props = {
            ...feature.properties,
            coverage: coverage
          };
          
          // Ensure admin_level is set (it should already be there from original GeoJSON)
          if (!props.admin_level && feature.properties?.admin_level) {
            props.admin_level = feature.properties.admin_level;
          }
          
          return {
            ...feature,
            properties: props
          };
        })
      };

      // Remove old neighborhoods layer
      if (neighborhoodsLayerRef.current && viewRef.current?.map) {
        viewRef.current.map.remove(neighborhoodsLayerRef.current);
      }

      // Create new layer with coverage
      const { default: GeoJSONLayer } = await import("@arcgis/core/layers/GeoJSONLayer");
      const [{ default: SimpleRenderer }, { default: SimpleFillSymbol }, { default: SimpleLineSymbol }] = await Promise.all([
        import("@arcgis/core/renderers/SimpleRenderer"),
        import("@arcgis/core/symbols/SimpleFillSymbol"),
        import("@arcgis/core/symbols/SimpleLineSymbol")
      ]);
      
      const blob = new Blob([JSON.stringify(updatedGeoJSON)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      // Log sample coverage values for debugging
      console.log("Sample coverage values:", updatedGeoJSON.features.slice(0, 5).map(f => ({
        id: f.id || f.properties?.id,
        name: f.properties?.name,
        coverage: f.properties?.coverage
      })));

      const heatmapLayer = new GeoJSONLayer({
        url: url,
        title: "neighborhoods (heatmap)",
        fields: [
          { name: "coverage", type: "double" },
          { name: "name", type: "string" },
          { name: "population", type: "double" },
          { name: "admin_level", type: "string" }
        ],
        popupTemplate: {
          title: "{name}",
          content: [{
            type: "text",
            text: "Name: <b>{name}</b><br/>Population: <b>{population}</b><br/>Coverage: <b>{expression/coverage-formatted}%</b><br/>Covered Population: <b>{expression/covered-population}</b><br/>Population that needs coverage: <b>{expression/uncovered-population}</b>"
          }],
          expressionInfos: [
            {
              name: "coverage-formatted",
              title: "Coverage",
              expression: "Round($feature.coverage * 100) / 100"
            },
            {
              name: "covered-population",
              title: "Covered Population",
              expression: "Round($feature.population * $feature.coverage / 100)"
            },
            {
              name: "uncovered-population",
              title: "Population that needs coverage",
              expression: "Round($feature.population * (100 - $feature.coverage) / 100)"
            }
          ]
        },
        renderer: new SimpleRenderer({
          symbol: new SimpleFillSymbol({
            color: [128, 128, 128, 0.5],
            outline: new SimpleLineSymbol({
              color: [110, 110, 110],
              width: 1
            })
          }),
          visualVariables: [{
            type: "color",
            field: "coverage",
            stops: [
              { value: 0, color: [255, 0, 0, 0.7], label: "0%" },
              { value: 25, color: [255, 165, 0, 0.7], label: "25%" },
              { value: 50, color: [255, 255, 0, 0.7], label: "50%" },
              { value: 75, color: [144, 238, 144, 0.7], label: "75%" },
              { value: 100, color: [0, 255, 0, 0.7], label: "100%" }
            ]
          }]
        })
      });

      await heatmapLayer.load();
      viewRef.current.map.add(heatmapLayer);
      neighborhoodsLayerRef.current = heatmapLayer;

      const avgCoverage = coverageData.reduce((sum, d) => sum + d.coverage, 0) / coverageData.length;
      setStatus?.(`Accessibility heatmap displayed. Average coverage: ${avgCoverage.toFixed(2)}%`);

    } catch (err) {
      console.error("Error showing accessibility heatmap:", err);
      setStatus?.(`Error: ${err.message}`);
    }
  }, [calculateNeighborhoodCoverage, setStatus]);

  return { mapRef, addGeoJsonLayer, goToBbox, updateTransportFilters, updateAdminLevelFilters, setupNeighborhoodClickFilter, showAccessibilityHeatmap };
}
