import React, { useState, useEffect } from 'react';
import axios from 'axios';
// https://kl.busz.in/api/where/stops-for-route/01_qihp.json?key=e0a817e1-b494-49da-8599-31a65208014f
// ─── API config ───────────────────────────────────────────────────────────────
const DEFAULT_ROUTE_ID = '01_qihp';
const API_BASE_URL = 'https://kl.busz.in/api/where/stops-for-route';
const API_KEY  = 'e0a817e1-b494-49da-8599-31a65208014f';

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

const STOP_H   = 20;                             // stop box height in SVG units
const STOP_TOP = (U.ROW_H - STOP_H) / 2;        // vertical offset to center box in row

const rowY = (i) => i * U.ROW_H + U.ROW_H / 2;
const routeUrl = (routeId) => `${API_BASE_URL}/${encodeURIComponent(routeId)}.json`;

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

// Bus box geometry + connector line endpoints
function getBusGeometry(bus, ox) {
  const connY      = rowY(bus.connectIndex);
  const boxCenterY = rowY(bus.connectIndex - 2);
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

// Auto-place 4 buses at proportional positions along the route
function makeBusConfig(stopCount) {
  return [
    { id: 'Bus 1', connectIndex: 2,                            side: 'left',  bg: '#4fc3f7', fg: '#01579b' },
    { id: 'Bus 2', connectIndex: Math.floor(stopCount * 0.30), side: 'right', bg: '#f28b8b', fg: '#7f0000' },
    { id: 'Bus 3', connectIndex: Math.floor(stopCount * 0.55), side: 'left',  bg: '#aed581', fg: '#33691e' },
    { id: 'Bus 4', connectIndex: Math.floor(stopCount * 0.80), side: 'right', bg: '#aed581', fg: '#33691e' },
  ];
}

function formatRouteLabel(route) {
  const shortName = route.shortName || route.nullSafeShortName;
  const routeName = decodeMojibake(route.longName || route.description || '');
  return [route.id, shortName, routeName].filter(Boolean).join(' - ');
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [columns, setColumns] = useState([]);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(DEFAULT_ROUTE_ID);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    axios
      .get(routeUrl(selectedRouteId), {
        params: { key: API_KEY },
        signal: controller.signal,
      })
      .then((res) => {
        const apiData = res.data.data;

        // Ordered stop IDs for this route
        const orderedIds =
          apiData.entry.stopGroupings[0].stopGroups[0].stopIds;

        // id → stop object lookup
        const stopMap = {};
        apiData.references.stops.forEach((s) => { stopMap[s.id] = s; });

        if (apiData.references.routes?.length) {
          setRouteOptions(apiData.references.routes);
        }

        // Ordered stops with id + name
        const stops = orderedIds.map((id) => ({
          id,
          name: decodeMojibake(stopMap[id]?.name ?? id),
        }));

        const buses  = makeBusConfig(stops.length);
        const column = { stops, buses };
        setColumns([column, { ...column }, { ...column }]);
        setLoading(false);
      })
      .catch((err) => {
        if (axios.isCancel(err) || err.name === 'CanceledError') {
          return;
        }

        setError(err.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [selectedRouteId]);

  const handleRouteChange = (event) => {
    setSelectedRouteId(event.target.value);
    setLoading(true);
    setError(null);
    setColumns([]);
  };

  const selectOptions = routeOptions.some((route) => route.id === selectedRouteId)
    ? routeOptions
    : [{ id: selectedRouteId, shortName: '', longName: '' }, ...routeOptions];
  const hasDiagram = columns.length > 0;
  const numCols = columns.length || 1;
  const maxRows = hasDiagram ? Math.max(...columns.map((c) => c.stops.length)) : 1;
  const VB_W    = numCols * U.COL_W + (numCols - 1) * U.COL_GAP;
  const VB_H    = maxRows * U.ROW_H;

  return (
    <div className="w-full min-h-screen bg-white">
      <div className="sticky top-0 z-10 w-full border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Route
            <select
              value={selectedRouteId}
              onChange={handleRouteChange}
              className="h-9 min-w-72 rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {selectOptions.map((route) => (
                <option key={route.id} value={route.id}>
                  {formatRouteLabel(route)}
                </option>
              ))}
            </select>
          </label>
          {loading && <span className="text-sm text-gray-500">Loading route data...</span>}
          {error && <span className="text-sm font-medium text-red-500">Error: {error}</span>}
        </div>
      </div>

      <div className="w-full flex items-start justify-center p-4 overflow-x-auto">
        {loading && !hasDiagram ? (
          <div className="flex min-h-96 flex-col items-center justify-center gap-3 text-gray-500">
            <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium">Loading route data...</span>
          </div>
        ) : error && !hasDiagram ? (
          <div className="flex min-h-96 items-center justify-center">
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

              {/* ── Connector lines (behind everything) ── */}
              {col.buses.map((bus) => {
                const { lx1, ly1, lx2, ly2 } = getBusGeometry(bus, ox);
                return (
                  <line
                    key={bus.id + '-line'}
                    x1={lx1} y1={ly1} x2={lx2} y2={ly2}
                    stroke="#555" strokeWidth={1}
                  />
                );
              })}

              {/* ── Stop boxes ──────────────────────────────────────────────
                  WHY foreignObject:
                  SVG <text> uses a basic glyph renderer that cannot handle
                  complex scripts — Malayalam ligatures and conjuncts break.
                  <foreignObject> hands rendering to the HTML engine, which
                  uses the OS shaping stack (HarfBuzz / CoreText / DirectWrite)
                  and correctly renders any Unicode script including Malayalam.
              ── */}
              {col.stops.map((stop, i) => (
                <g key={'stop-' + i}>
                  {/* Yellow background rect */}
                  <rect
                    x={ox + U.STOP_X}
                    y={i * U.ROW_H + STOP_TOP}
                    width={U.STOP_W}
                    height={STOP_H}
                    fill="#ffff00"
                    stroke="#ccc"
                    strokeWidth={0.5}
                  />

                  {/* HTML text via foreignObject — handles Malayalam correctly */}
                  <foreignObject
                    x={ox + U.STOP_X}
                    y={i * U.ROW_H + STOP_TOP}
                    width={U.STOP_W}
                    height={STOP_H}
                  >
                    {/*
                      xmlns is required — foreignObject content must declare
                      the XHTML namespace for browsers to parse it correctly.
                    */}
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

              {/* ── Node dots (on top of lines) ── */}
              {col.stops.map((_, i) => (
                <React.Fragment key={'node-' + i}>
                  <circle cx={ox + U.LEFT_NODE_X}  cy={rowY(i)} r={U.NODE_R} fill="#111" />
                  <circle cx={ox + U.RIGHT_NODE_X} cy={rowY(i)} r={U.NODE_R} fill="#111" />
                </React.Fragment>
              ))}

              {/* ── Bus label boxes ── */}
              {col.buses.map((bus) => {
                const { boxLeft, boxTop } = getBusGeometry(bus, ox);
                return (
                  <g key={bus.id + '-box'}>
                    <rect
                      x={boxLeft} y={boxTop}
                      width={U.BUS_W} height={U.BUS_H}
                      fill={bus.bg} stroke="#555" strokeWidth={1} rx={4}
                    />
                    {/* Bus labels are English — plain SVG text is fine here */}
                    <text
                      x={boxLeft + U.BUS_W / 2}
                      y={boxTop  + U.BUS_H / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                      fontWeight="500"
                      fill={bus.fg}
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
