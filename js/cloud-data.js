// Datenzugriff für Cloud-Logs: Flugliste und Rohdateien aus Supabase ("Skyseed Apps",
// Schema app_companion), Flächen und Blöcke aus dem Skyseed-Dashboard, Zuordnung per Geometrie.
//
// Reine Daten- und Geometrielogik ohne DOM, damit sie unter Node prüfbar ist (siehe Ende der Datei).
// Die Oberfläche steht in js/cloud-ui.js.
//
// Voraussetzung im Browser: window.supabase (supabase-js UMD) und SkyseedAuth (guard() mit
// supabase-Option, damit der Client angemeldet ist und RLS auf "authenticated" greift).

var CloudData = (function () {
    'use strict';

    var SUPABASE_URL = 'https://lnhwwggxykgmjumaqobk.supabase.co';
    // Anon-Key (öffentlich vorgesehen). Der neue sb_publishable-Key ist kein JWT und wird von der
    // Gateway-Prüfung der Bridge-Function abgelehnt, daher wie bei den anderen Apps der alte Key.
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuaHd3Z2d4eWtnbWp1bWFxb2JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1OTgyOTMsImV4cCI6MjA5OTE3NDI5M30.A7hofxFBAKD771A-98R94ILxeAQp4XpSIkiPKJvpnSY';
    var BUCKET = 'companion-flightlogs';
    var SCHEMA = 'app_companion';
    var PAGE = 1000;

    var sb = null;

    function client() {
        if (!sb) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return sb;
    }

    // --- Flüge aus Supabase ---

    // Alle gespeicherten Flüge, neueste zuerst. RLS lässt nur status = 'stored' durch.
    function listFlights() {
        var all = [];
        function next(from) {
            return client().schema(SCHEMA).from('flights')
                .select('flight_uid, drone_id, flight_id, started_at, ended_at, records, complete, seeded, ' +
                    'auto_seconds, min_lat, min_lon, max_lat, max_lon, is_test, storage_path, gz_bytes')
                .order('started_at', { ascending: false })
                .range(from, from + PAGE - 1)
                .then(function (res) {
                    if (res.error) throw new Error(res.error.message);
                    all = all.concat(res.data);
                    return res.data.length === PAGE ? next(from + PAGE) : all;
                });
        }
        return next(0);
    }

    function gunzip(blob) {
        if (typeof DecompressionStream === 'undefined') {
            return Promise.reject(new Error('Dieser Browser kann gzip nicht entpacken'));
        }
        return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
    }

    // Dateiname wie im Companion (flight_<flight_id>.jsonl), damit dieselbe Datei per
    // Drag & Drop und aus der Cloud als Duplikat erkannt wird.
    function fileName(flight) {
        return 'flight_' + flight.flight_id + '.jsonl';
    }

    function downloadFlight(flight) {
        return client().storage.from(BUCKET).download(flight.storage_path).then(function (res) {
            if (res.error) throw new Error(res.error.message || 'Download fehlgeschlagen');
            return gunzip(res.data);
        }).then(function (blob) {
            return new File([blob], fileName(flight), { type: 'application/x-ndjson' });
        });
    }

    // --- Flächen und Blöcke aus dem Dashboard ---

    // Alle Seiten einer paginierten Dashboard-Liste. fetchDashboard erwartet einen Pfad.
    function fetchAllPages(path, fetchDashboard) {
        var items = [];
        function next(p) {
            return fetchDashboard(p).then(function (data) {
                items = items.concat(Array.isArray(data) ? data : (data.results || []));
                if (Array.isArray(data) || !data.next) return items;
                var u = new URL(data.next);
                return next(u.pathname + u.search);
            });
        }
        return next(path);
    }

    // Blöcke sind im Dashboard Seeddrops ("Drops") mit Geometrie (geojson) und Bezug zur Fläche.
    function loadBlocks(fetchDashboard) {
        return fetchAllPages('/api/seeddrops/?page_size=200', fetchDashboard).then(function (drops) {
            return drops.map(normalizeBlock).filter(function (b) { return b !== null; });
        });
    }

    function normalizeBlock(d) {
        if (!d || d.id === undefined || d.id === null) return null;
        var rings = polygonsFromGeoJson(d.geojson);
        var areaName = d.project_area_name || ('Fläche ' + d.area);
        var blockName = d.name || ('Block ' + (d.index !== undefined && d.index !== null ? d.index : d.id));
        return {
            id: d.id,
            areaId: d.area,
            areaName: String(areaName),
            name: String(blockName),
            label: areaName + ' · ' + blockName,
            season: d.project_season || null,
            year: d.project_year || null,
            rings: rings,
            bbox: rings.length ? bboxOfRings(rings) : null
        };
    }

    // --- Geometrie ---
    // Ringe sind Listen von [lon, lat] (GeoJSON-Reihenfolge). Löcher werden ignoriert: für die
    // Zuordnung eines Flugs genügt die Außenkontur.

    function polygonsFromGeoJson(g) {
        if (typeof g === 'string') {
            try { g = JSON.parse(g); } catch (e) { return []; }
        }
        var rings = [];
        (function walk(node) {
            if (!node || typeof node !== 'object') return;
            switch (node.type) {
                case 'FeatureCollection': (node.features || []).forEach(walk); break;
                case 'Feature': walk(node.geometry); break;
                case 'GeometryCollection': (node.geometries || []).forEach(walk); break;
                case 'Polygon':
                    if (node.coordinates && node.coordinates[0]) rings.push(cleanRing(node.coordinates[0]));
                    break;
                case 'MultiPolygon':
                    (node.coordinates || []).forEach(function (poly) {
                        if (poly && poly[0]) rings.push(cleanRing(poly[0]));
                    });
                    break;
            }
        })(g);
        return rings.filter(function (r) { return r.length >= 3; });
    }

    function cleanRing(ring) {
        return ring.filter(function (p) {
            return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
        }).map(function (p) { return [Number(p[0]), Number(p[1])]; });
    }

    function bboxOfRings(rings) {
        var b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
        rings.forEach(function (ring) {
            ring.forEach(function (p) {
                if (p[0] < b.minLon) b.minLon = p[0];
                if (p[0] > b.maxLon) b.maxLon = p[0];
                if (p[1] < b.minLat) b.minLat = p[1];
                if (p[1] > b.maxLat) b.maxLat = p[1];
            });
        });
        return b;
    }

    function pointInRing(lon, lat, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    function segmentsCross(a, b, c, d) {
        function orient(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
        var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0) && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
    }

    // Schneidet das Rechteck (Bounding Box eines Flugs) die Fläche des Rings?
    function rectIntersectsRing(rect, ring) {
        var corners = [
            [rect.minLon, rect.minLat], [rect.maxLon, rect.minLat],
            [rect.maxLon, rect.maxLat], [rect.minLon, rect.maxLat]
        ];
        // Ring-Punkt im Rechteck
        for (var i = 0; i < ring.length; i++) {
            var p = ring[i];
            if (p[0] >= rect.minLon && p[0] <= rect.maxLon && p[1] >= rect.minLat && p[1] <= rect.maxLat) return true;
        }
        // Rechteck-Ecke im Ring (Rechteck liegt ganz in der Fläche oder darüber)
        for (var c = 0; c < 4; c++) {
            if (pointInRing(corners[c][0], corners[c][1], ring)) return true;
        }
        // Kanten kreuzen sich
        for (var k = 0; k < ring.length; k++) {
            var a = ring[k], b = ring[(k + 1) % ring.length];
            for (var e = 0; e < 4; e++) {
                if (segmentsCross(a, b, corners[e], corners[(e + 1) % 4])) return true;
            }
        }
        return false;
    }

    function flightRect(f) {
        if (f.min_lat === null || f.min_lon === null || f.max_lat === null || f.max_lon === null ||
            f.min_lat === undefined) return null;
        return { minLat: f.min_lat, minLon: f.min_lon, maxLat: f.max_lat, maxLon: f.max_lon };
    }

    function bboxOverlap(a, b) {
        return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
    }

    // Blöcke, deren Fläche die Bounding Box des Flugs berührt. Das sind Kandidaten, kein Beweis:
    // ein Transferflug über einen Block zählt ebenfalls. Genauer wird es erst mit der Flugbahn.
    function blocksForFlight(flight, blocks) {
        var rect = flightRect(flight);
        if (!rect) return [];
        return blocks.filter(function (b) {
            if (!b.bbox || !bboxOverlap(rect, b.bbox)) return false;
            return b.rings.some(function (ring) { return rectIntersectsRing(rect, ring); });
        });
    }

    // flight_uid -> Liste der Block-IDs
    function assign(flights, blocks) {
        var map = {};
        flights.forEach(function (f) {
            map[f.flight_uid] = blocksForFlight(f, blocks).map(function (b) { return b.id; });
        });
        return map;
    }

    // Fläche -> Blöcke, sortiert nach Flächenname, für die Auswahl
    function groupByArea(blocks) {
        var areas = {};
        blocks.forEach(function (b) {
            if (!areas[b.areaId]) areas[b.areaId] = { id: b.areaId, name: b.areaName, blocks: [] };
            areas[b.areaId].blocks.push(b);
        });
        return Object.keys(areas).map(function (k) { return areas[k]; }).sort(function (a, b) {
            return a.name.localeCompare(b.name, 'de');
        }).map(function (a) {
            a.blocks.sort(function (x, y) { return x.name.localeCompare(y.name, 'de', { numeric: true }); });
            return a;
        });
    }

    // Filter der Flugliste. opts: text, from/to (ms, Tagesgrenzen lokal), drone, showTests,
    // blockIds (Set, leer = alle), assignment (flight_uid -> Block-IDs)
    function filterFlights(flights, opts) {
        var text = (opts.text || '').trim().toLowerCase();
        return flights.filter(function (f) {
            if (!opts.showTests && f.is_test) return false;
            if (opts.drone && f.drone_id !== opts.drone) return false;
            var t = Date.parse(f.started_at);
            if (opts.from !== null && opts.from !== undefined && t < opts.from) return false;
            if (opts.to !== null && opts.to !== undefined && t >= opts.to) return false;
            if (text) {
                var hay = (f.flight_id + ' ' + f.drone_id + ' ' + f.started_at + ' ' + opts.dateLabel(f) + ' ' +
                    (opts.blockLabels ? opts.blockLabels(f) : '')).toLowerCase();
                if (hay.indexOf(text) === -1) return false;
            }
            if (opts.blockIds && opts.blockIds.size) {
                var ids = (opts.assignment && opts.assignment[f.flight_uid]) || [];
                if (!ids.some(function (id) { return opts.blockIds.has(id); })) return false;
            }
            return true;
        });
    }

    return {
        client: client,
        listFlights: listFlights,
        downloadFlight: downloadFlight,
        fileName: fileName,
        loadBlocks: loadBlocks,
        fetchAllPages: fetchAllPages,
        normalizeBlock: normalizeBlock,
        polygonsFromGeoJson: polygonsFromGeoJson,
        blocksForFlight: blocksForFlight,
        assign: assign,
        groupByArea: groupByArea,
        filterFlights: filterFlights,
        _rectIntersectsRing: rectIntersectsRing
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CloudData;
