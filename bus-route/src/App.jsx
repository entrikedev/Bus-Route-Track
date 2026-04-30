import React, { useState, useEffect } from 'react';
import axios from 'axios';


const STOPS_API_BASE_URL = import.meta.env.VITE_STOPS_API_BASE_URL;
const TRIPS_API_BASE_URL = import.meta.env.VITE_TRIPS_API_BASE_URL;
const API_KEY = import.meta.env.VITE_API_KEY;
const DEFAULT_ROUTE_ID = '01_fm94';


// ─── SVG layout constants (SVG units — scale with viewBox) ───────────────────
const U = {
  ROW_H:        30,
  LEFT_BUS_W:   88,
  NODE_AREA:    16,
  STOP_MX:       4,
  STOP_W:      170,
  RIGHT_BUS_W:  88,
  BUS_W:        64,
  BUS_H:        24,
  NODE_R:        4,
  COL_GAP:      44,
};

U.LEFT_NODE_X      = U.LEFT_BUS_W + U.NODE_AREA / 2;
U.STOP_X           = U.LEFT_BUS_W + U.NODE_AREA + U.STOP_MX;
U.RIGHT_NODE_X     = U.STOP_X + U.STOP_W + U.STOP_MX + U.NODE_AREA / 2;
U.BUS_AREA_RIGHT_X = U.STOP_X + U.STOP_W + U.STOP_MX + U.NODE_AREA;
U.COL_W            = U.LEFT_BUS_W + U.NODE_AREA + U.STOP_MX + U.STOP_W
                   + U.STOP_MX + U.NODE_AREA + U.RIGHT_BUS_W;

const STOP_H   = 20;
const STOP_TOP = (U.ROW_H - STOP_H) / 2;

const rowY = (i) => i * U.ROW_H + U.ROW_H / 2;
const stopsUrl = (routeId) => `${STOPS_API_BASE_URL}/${encodeURIComponent(routeId)}.json`;
const tripsUrl = (routeId) => `${TRIPS_API_BASE_URL}/${encodeURIComponent(routeId)}.json`;

const MOJIBAKE_RE = /(?:à|Ã|Â|â|€|œ||™|‹|¢|¥|¦|§|¨|©|ª|«|¬|®|¯|°|±|²|³|´|µ|¶|·|¸|¹|º|»|¼|½|¾|¿)/;
const WINDOWS_1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function recoverMojibakeBytes(value) {
  return Uint8Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return WINDOWS_1252_BYTES.get(code) ?? (code & 0xff);
  });
}



function decodeMojibake(value) {
  if (typeof value !== 'string') {
    return value;
  }
  let decoded = value;
  for (let i = 0; i < 3 && MOJIBAKE_RE.test(decoded); i += 1) {
    try {
      const next = new TextDecoder('utf-8', { fatal: true }).decode(recoverMojibakeBytes(decoded));
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}




function getBusGeometry(bus, ox) {
  const connY      = rowY(bus.connectIndex);
  const boxCenterY = rowY(Math.max(0, bus.connectIndex - 2)); 
  const boxTop     = boxCenterY - U.BUS_H / 2;

  if (bus.side === 'left') {
    const boxLeft = ox + (U.LEFT_BUS_W - U.BUS_W) / 2;
    return { boxLeft, boxTop,
      lx1: boxLeft + U.BUS_W,  ly1: boxCenterY,
      lx2: ox + U.LEFT_NODE_X, ly2: connY };
  } else {
    const boxLeft = ox + U.BUS_AREA_RIGHT_X + (U.RIGHT_BUS_W - U.BUS_W) / 2;
    return { boxLeft, boxTop,
      lx1: boxLeft,              ly1: boxCenterY,
      lx2: ox + U.RIGHT_NODE_X,  ly2: connY };
  }
}

function processActiveBuses(tripsData, stopsArray) {
  if (!tripsData || !tripsData.list) return [];

  const activeTrips = tripsData.list.filter(
    (trip) => trip.status && (trip.status.phase === "in_progress" || trip.status.phase === "")
  );

  const buses = [];
  const occupiedSpots = new Set(); 

  activeTrips.forEach((trip, idx) => {
    const closestStopId = trip.status.closestStop;
    const connectIndex = stopsArray.findIndex((s) => s.id === closestStopId);

    if (connectIndex !== -1) {
      let side = 'left';
      if (occupiedSpots.has(`${connectIndex}-left`)) {
        side = 'right';
      }
      occupiedSpots.add(`${connectIndex}-${side}`);

      const bg = side === 'left' ? '#4fc3f7' : '#f28b8b';
      const fg = side === 'left' ? '#01579b' : '#7f0000';

      const rawId = trip.status.activeTripId || trip.tripId || `Bus ${idx + 1}`;
      const shortId = rawId.includes('_') ? rawId.split('_').pop().slice(-5) : rawId.slice(-5);

      buses.push({
        id: shortId,
        connectIndex,
        side,
        bg,
        fg,
        rawData: trip 
      });
    }
  });

  return buses;
}

function formatRouteLabel(route) {
  const shortName = route.shortName || route.nullSafeShortName;
  const routeName = decodeMojibake(route.longName || route.description || '');
  return [route.id, shortName, routeName].filter(Boolean).join(' - ');
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [columns, setColumns] = useState([]);
  const [allRoutes, setAllRoutes] = useState([]);
  const [selectedRouteIds, setSelectedRouteIds] = useState([DEFAULT_ROUTE_ID]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null });

  useEffect(() => {
    const controller = new AbortController();
    axios.get(stopsUrl(DEFAULT_ROUTE_ID), { params: { key: API_KEY }, signal: controller.signal })
      .then(res => {
        if (res.data?.data?.references?.routes?.length) {
          setAllRoutes(res.data.data.references.routes);
        }
      })
      .catch((err) => {
        if (axios.isCancel(err) || err.name === 'CanceledError') return;
        console.error("Failed to fetch route list:", err);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const intervalIds = [];

    if (selectedRouteIds.length === 0) {
      setColumns([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchDataForRoutes = async () => {
      try {
        const routeDataPromises = selectedRouteIds.map(routeId =>
          Promise.all([
            axios.get(stopsUrl(routeId), { params: { key: API_KEY }, signal: controller.signal }),
            axios.get(tripsUrl(routeId), { params: { key: API_KEY }, signal: controller.signal })
          ]).catch(err => ({ error: err, routeId }))
        );

        const results = await Promise.all(routeDataPromises);

        // If the component unmounted or effect re-ran, stop processing
        if (controller.signal.aborted) return;

        const newColumns = [];
        const errors = [];

        results.forEach((result, index) => {
          if (result.error) {
            // Safely ignore canceled requests
            if (axios.isCancel(result.error) || result.error.name === 'CanceledError') return;

            errors.push(`Failed to load route ${result.routeId}: ${result.error.message}`);
            return;
          }

          const [stopsRes, tripsRes] = result;
          const stopsApiData = stopsRes.data.data;
          const tripsApiData = tripsRes.data.data;
          const routeId = selectedRouteIds[index];

          const stopGroups = stopsApiData.entry.stopGroupings[0]?.stopGroups;
          if (!stopGroups || stopGroups.length === 0) {
            errors.push(`No stop groups found for route ${routeId}.`);
            return;
          }
          const orderedIds = stopGroups[0].stopIds;
          const stopMap = {};
          stopsApiData.references.stops.forEach((s) => { stopMap[s.id] = s; });

          const currentStops = orderedIds.map((id) => ({
            id,
            name: decodeMojibake(stopMap[id]?.name ?? id),
          }));

          const buses = processActiveBuses(tripsApiData, currentStops);

          newColumns.push({ stops: currentStops, buses, routeId });
        });

        if (errors.length > 0) {
          setError(errors.join('; '));
        }

        setColumns(newColumns);
        setLoading(false);

        newColumns.forEach((column) => {
          const intervalId = setInterval(() => {
            axios.get(tripsUrl(column.routeId), { params: { key: API_KEY } })
              .then((res) => {
                const updatedBuses = processActiveBuses(res.data.data, column.stops);
                setColumns(prevColumns => {
                  const targetIndex = prevColumns.findIndex(c => c.routeId === column.routeId);
                  if (targetIndex === -1) return prevColumns;

                  const nextColumns = [...prevColumns];
                  nextColumns[targetIndex] = { ...nextColumns[targetIndex], buses: updatedBuses };
                  return nextColumns;
                });
              })
              .catch((err) => console.error(`Polling for route ${column.routeId} failed:`, err));
          }, 5000);
          intervalIds.push(intervalId);
        });

      } catch (err) {
        if (axios.isCancel(err) || err.name === 'CanceledError') return;
        setError(err.message);
        setLoading(false);
      }
    };

    fetchDataForRoutes();

    return () => {
      controller.abort();
      intervalIds.forEach(clearInterval);
    };
  }, [selectedRouteIds]);

  const handleRouteChange = (index, newRouteId) => {
    setSelectedRouteIds(prev => {
      const newIds = [...prev];
      newIds[index] = newRouteId;
      return newIds;
    });
  };

  const handleAddRoute = () => {
    const firstUnselectedRoute = allRoutes.find(opt => !selectedRouteIds.includes(opt.id));
    const newRouteId = firstUnselectedRoute ? firstUnselectedRoute.id : (allRoutes[0]?.id || DEFAULT_ROUTE_ID);
    setSelectedRouteIds(prev => [...prev, newRouteId]);
  };

  const handleRemoveRoute = (index) => {
    setSelectedRouteIds(prev => prev.filter((_, i) => i !== index));
  };

  const hasDiagram = columns.length > 0;
  const numCols = columns.length || 1;
  const maxRows = hasDiagram ? Math.max(...columns.map((c) => c.stops.length)) : 1;
  const VB_W    = numCols * U.COL_W + (numCols - 1) * U.COL_GAP;
  const VB_H    = maxRows * U.ROW_H;

  return (
    <div className="w-full min-h-screen bg-white relative">
      
      {/* ── Tooltip Overlay ── */}
      {tooltip.visible && tooltip.data && (
        <div 
          className="fixed z-50 bg-white border border-slate-200 shadow-xl rounded-lg p-4 text-xs text-slate-700 pointer-events-none w-72 transition-opacity duration-200"
          style={{ top: tooltip.y + 15, left: tooltip.x + 15 }}
        >
          <h4 className="font-bold text-slate-900 mb-2 border-b pb-1 text-sm">Bus Details</h4>
          <div className="flex flex-col gap-1.5">
            <p><span className="font-semibold text-slate-500">Trip ID:</span> {tooltip.data.tripId}</p>
            <p><span className="font-semibold text-slate-500">Vehicle ID:</span> {tooltip.data.status.vehicleId || tooltip.data.status.activeTripId || 'N/A'}</p>
            <p><span className="font-semibold text-slate-500">Phase:</span> {tooltip.data.status.phase || 'N/A'}</p>
            <p><span className="font-semibold text-slate-500">Distance Along Trip:</span> {tooltip.data.status.totalDistanceAlongTrip?.toFixed(2)}m</p>
            <p><span className="font-semibold text-slate-500">Sched Deviation:</span> {tooltip.data.status.scheduleDeviation}s</p>
            <p><span className="font-semibold text-slate-500">Next Stop Offset:</span> {tooltip.data.status.nextStopTimeOffset}s</p>
            <p><span className="font-semibold text-slate-500">Lat/Lon:</span> {tooltip.data.status.position?.lat?.toFixed(4)}, {tooltip.data.status.position?.lon?.toFixed(4)}</p>
            <p><span className="font-semibold text-slate-500">Last Update:</span> {new Date(tooltip.data.status.lastUpdateTime || tooltip.data.serviceDate).toLocaleTimeString()}</p>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-10 w-full border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex w-full flex-wrap items-center gap-4">
          {selectedRouteIds.map((routeId, index) => {
            const getDropdownOptions = (rId) => {
              if (allRoutes.some(r => r.id === rId)) return allRoutes;
              return [{ id: rId, shortName: '', longName: `Route ${rId}` }, ...allRoutes];
            };
            const dropdownOptions = getDropdownOptions(routeId);

            return (
              <div key={index} className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  Route
                  <select
                    value={routeId}
                    onChange={(e) => handleRouteChange(index, e.target.value)}
                    className="h-9 w-48 sm:w-64 truncate rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {dropdownOptions.map((route) => (
                      <option key={route.id} value={route.id}>
                        {formatRouteLabel(route)}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedRouteIds.length > 1 && (
                  <button
                    onClick={() => handleRemoveRoute(index)}
                    className="flex items-center justify-center h-9 w-9 text-lg font-medium text-red-600 bg-red-50 rounded border border-red-200 hover:bg-red-100"
                    title="Remove Route"
                  >
                    &times;
                  </button>
                )}
              </div>
            );
          })}
          {selectedRouteIds.length < 4 && (
            <button onClick={handleAddRoute} className="h-9 px-4 text-sm font-medium text-white bg-blue-500 rounded hover:bg-blue-600">
              + Add Route
            </button>
          )}
          {loading && <span className="text-sm text-gray-500 flex items-center gap-2">
             <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" /><path d="M12 2a10 10 0 0 1 10 10" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" /></svg> Loading route data...
          </span>}
          {error && <span className="text-sm font-medium text-red-500">Error: {error}</span>}
          {!loading && !error && <span className="text-xs text-emerald-500 font-medium ml-auto flex items-center gap-1">
             {/* <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live Sync Active */}
          </span>}
        </div>
      </div>

      <div className={`w-full flex items-start p-4 overflow-x-auto ${hasDiagram ? 'justify-start' : 'justify-center'}`}>
        {loading && !hasDiagram ? (
          <div className="flex min-h-96 w-full flex-col items-center justify-center gap-3 text-gray-500">
            <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium">Loading route data...</span>
          </div>
        ) : error && !hasDiagram ? (
          <div className="flex min-h-96 w-full items-center justify-center">
            <p className="text-red-500 text-sm font-medium">Error: {error}</p>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            style={{ display: 'block', overflow: 'visible', maxWidth: VB_W }}
            preserveAspectRatio="xMidYMid meet"
          >
            {columns.map((col, colIdx) => {
          const ox   = colIdx * (U.COL_W + U.COL_GAP);
          const colH = col.stops.length * U.ROW_H;

          return (
            <g key={colIdx}>

              {/* ── Vertical track lines ── */}
              <line x1={ox + U.LEFT_NODE_X}  y1={0} x2={ox + U.LEFT_NODE_X}  y2={colH} stroke="#111" strokeWidth={2} />
              <line x1={ox + U.RIGHT_NODE_X} y1={0} x2={ox + U.RIGHT_NODE_X} y2={colH} stroke="#111" strokeWidth={2} />

              {/* ── Connector lines (Animated) ── */}
              {col.buses.map((bus) => {
                const { lx1, ly1, lx2, ly2 } = getBusGeometry(bus, ox);
                return (
                  <line
                    key={bus.id + '-line'}
                    x1={lx1} y1={ly1} x2={lx2} y2={ly2}
                    stroke="#555" strokeWidth={1}
                    className="transition-all duration-700 ease-in-out" // Smoothes the line movement
                  />
                );
              })}

              {/* ── Stop boxes ── */}
              {col.stops.map((stop, i) => (
                <g key={'stop-' + i}>
                  <rect
                    x={ox + U.STOP_X}
                    y={i * U.ROW_H + STOP_TOP}
                    width={U.STOP_W}
                    height={STOP_H}
                    fill="#ffff00"
                    stroke="#ccc"
                    strokeWidth={0.5}
                  />

                  <foreignObject
                    x={ox + U.STOP_X}
                    y={i * U.ROW_H + STOP_TOP}
                    width={U.STOP_W}
                    height={STOP_H}
                  >
                    <div
                      xmlns="http://www.w3.org/1999/xhtml"
                      style={{
                        width:          '100%',
                        height:         '100%',
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'center',
                        fontSize:       '9.5px',
                        lineHeight:     1,
                        color:          '#111',
                        overflow:       'hidden',
                        whiteSpace:     'nowrap',
                        textOverflow:   'ellipsis',
                        padding:        '0 3px',
                        boxSizing:      'border-box',
                        fontFamily:     '"Noto Sans Malayalam", "Nirmala UI", Kartika, system-ui, sans-serif',
                      }}
                      title={stop.name}
                    >
                      {stop.name}
                    </div>
                  </foreignObject>
                </g>
              ))}

              {/* ── Node dots ── */}
              {col.stops.map((_, i) => (
                <React.Fragment key={'node-' + i}>
                  <circle cx={ox + U.LEFT_NODE_X}  cy={rowY(i)} r={U.NODE_R} fill="#111" />
                  <circle cx={ox + U.RIGHT_NODE_X} cy={rowY(i)} r={U.NODE_R} fill="#111" />
                </React.Fragment>
              ))}

              {/* ── Bus label boxes (Animated & Interactive) ── */}
              {col.buses.map((bus) => {
                const { boxLeft, boxTop } = getBusGeometry(bus, ox);
                return (
                  <g 
                    key={bus.id + '-box'}
                    className="cursor-pointer hover:opacity-80 transition-all duration-700 ease-in-out" // Smoothes the box & text movement
                    onMouseEnter={(e) => {
                      setTooltip({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        data: bus.rawData
                      });
                    }}
                    onMouseMove={(e) => {
                      setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
                    }}
                    onMouseLeave={() => {
                      setTooltip({ visible: false, x: 0, y: 0, data: null });
                    }}
                  >
                    <rect
                      x={boxLeft} y={boxTop}
                      width={U.BUS_W} height={U.BUS_H}
                      fill={bus.bg} stroke="#555" strokeWidth={1} rx={4}
                    />
                    <text
                      x={boxLeft + U.BUS_W / 2}
                      y={boxTop  + U.BUS_H / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                      fontWeight="500"
                      fill={bus.fg}
                      className="pointer-events-none"
                    >
                      {bus.id}
                    </text>
                  </g>
                );
              })}

            </g>
          );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}