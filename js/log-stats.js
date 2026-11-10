// Statistik und Saatflächen-Berechnung auf Basis normalisierter Samples (siehe log-parser.js).
//
// Kategorien je Abschnitt zwischen zwei Samples (bestimmt durch das erste Sample):
//   seed      Seeder fördert, Behälter nicht leer      -> Saatlinie
//   empty     Seeder fördert, Behälter als leer gemeldet -> Saatlinie ohne Saatgut
//   transfer  Seeder aus                               -> Transferlinie

var LogStats = (function () {

    var R = 6371008.8;                 // mittlerer Erdradius in m
    var DT_CAP_S = 5;                  // Zeitlücken über 5 s zählen nicht als Flug-/Saatzeit
    var WEIGHT_WINDOW = 30;            // Samples (~10 s) für Gewichts-Median vor/nach der Saat
    var RADAR_MIN_REL_ALT_M = 3;       // Frontradar-Minimum erst ab 3 m über Start (ohne Start/Landung)
    var MIN_LANE_M = 5;                // kürzere Saatabschnitte zählen nicht als Saatbahn

    function rad(d) { return d * Math.PI / 180; }

    function dist(a, b) {
        var dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
        var s = Math.sin(dLat / 2), t = Math.sin(dLon / 2);
        var h = s * s + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * t * t;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function category(s) {
        if (!s.seeding) return 'transfer';
        return s.empty ? 'empty' : 'seed';
    }

    function median(arr) {
        if (!arr.length) return null;
        var a = arr.slice().sort(function (x, y) { return x - y; });
        var m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }

    function weightMedian(samples, from, to) {
        var w = [];
        for (var i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
            if (samples[i].weightOk && samples[i].weightG !== null) w.push(samples[i].weightG);
        }
        return median(w);
    }

    // Zusammenhängende Abschnitte gleicher Kategorie als Polylinien ([[lat,lon],...]).
    function buildSegments(samples) {
        var segs = [];
        if (samples.length < 2) return segs;
        var cur = null;
        for (var i = 0; i < samples.length - 1; i++) {
            var c = category(samples[i]);
            if (!cur || cur.cat !== c) {
                cur = { cat: c, pts: [[samples[i].lat, samples[i].lon]], len: 0 };
                segs.push(cur);
            }
            cur.pts.push([samples[i + 1].lat, samples[i + 1].lon]);
            cur.len += dist(samples[i], samples[i + 1]);
        }
        return segs;
    }

    function compute(parsed) {
        var S = parsed.samples;
        var st = {
            points: S.length,
            start: S.length ? S[0].t : null,
            end: S.length ? S[S.length - 1].t : null,
            flightTime: 0, seedTime: 0, emptyTime: 0,
            dist: 0, seedDist: 0, emptyDist: 0, transferDist: 0,
            lanes: 0,
            targetRpm: null, measRpm: null, spreaderRpm: null,
            seedSpeed: null, maxSpeed: null,
            minHeight: null, medianHeight: null, minFront: null,
            gpsHdop: null, gpsAccM: null, gpsSats: null,
            weightStart: null, weightEnd: null, weightDropped: null,
            emptyAt: null, unreachableTime: 0,
            missionMax: null, missionCount: null, missions: 0,
            modes: {}
        };

        var acc = { tRpm: 0, tRpmT: 0, mRpm: 0, mRpmT: 0, spRpm: 0, spRpmT: 0, spd: 0, spdT: 0,
            hdop: 0, hdopN: 0, accM: 0, accN: 0, sats: 0, satsN: 0 };
        var heights = [];
        var firstSeed = -1, lastSeed = -1;

        for (var i = 0; i < S.length; i++) {
            var s = S[i];
            if (s.seeding && !s.empty) {
                if (firstSeed < 0) firstSeed = i;
                lastSeed = i;
            }
            if (s.empty && st.emptyAt === null) st.emptyAt = s.t;
            if (s.speed !== null && (st.maxSpeed === null || s.speed > st.maxSpeed)) st.maxSpeed = s.speed;
            // Wechselt mission_count, wurde eine neue Mission hochgeladen: Wegpunkte neu zählen
            if (s.missionCount !== null && s.missionCount > 0) {
                if (s.missionCount !== st.missionCount) {
                    st.missionCount = s.missionCount;
                    st.missionMax = null;
                    st.missions++;
                }
                if (s.missionSeq !== null && (st.missionMax === null || s.missionSeq > st.missionMax)) st.missionMax = s.missionSeq;
            }

            if (s.inAir) {
                if (s.gpsHdop !== null) { acc.hdop += s.gpsHdop; acc.hdopN++; }
                if (s.gpsAccM !== null) { acc.accM += s.gpsAccM; acc.accN++; }
                if (s.gpsSats !== null) { acc.sats += s.gpsSats; acc.satsN++; }
                if (s.frontCm !== null && (s.relAlt === null || s.relAlt > RADAR_MIN_REL_ALT_M) &&
                    (st.minFront === null || s.frontCm < st.minFront.v)) {
                    st.minFront = { v: s.frontCm, lat: s.lat, lon: s.lon, t: s.t };
                }
            }
            if (s.seeding && !s.empty && s.heightCm !== null) {
                heights.push(s.heightCm);
                if (st.minHeight === null || s.heightCm < st.minHeight.v) {
                    st.minHeight = { v: s.heightCm, lat: s.lat, lon: s.lon, t: s.t };
                }
            }

            if (i === S.length - 1) break;
            var n = S[i + 1];
            var d = dist(s, n);
            var dt = Math.min(Math.max((n.t - s.t) / 1000, 0), DT_CAP_S);
            var cat = category(s);
            st.dist += d;
            if (cat === 'seed') { st.seedDist += d; st.seedTime += dt; }
            else if (cat === 'empty') { st.emptyDist += d; st.emptyTime += dt; }
            else st.transferDist += d;
            if (s.inAir) {
                st.flightTime += dt;
                if (s.mode) st.modes[s.mode] = (st.modes[s.mode] || 0) + dt;
            }
            if (s.seederStatus === 'unreachable') st.unreachableTime += dt;
            if (cat === 'seed') {
                if (s.targetRpm !== null) { acc.tRpm += s.targetRpm * dt; acc.tRpmT += dt; }
                if (s.measRpm !== null && s.measRpm > 0) { acc.mRpm += s.measRpm * dt; acc.mRpmT += dt; }
                if (s.speed !== null) { acc.spd += s.speed * dt; acc.spdT += dt; }
            }
            if (s.spreaderRpm !== null && s.spreaderRpm > 0) { acc.spRpm += s.spreaderRpm * dt; acc.spRpmT += dt; }
        }

        st.targetRpm = acc.tRpmT ? acc.tRpm / acc.tRpmT : null;
        st.measRpm = acc.mRpmT ? acc.mRpm / acc.mRpmT : null;
        st.spreaderRpm = acc.spRpmT ? acc.spRpm / acc.spRpmT : null;
        st.seedSpeed = acc.spdT ? acc.spd / acc.spdT : null;
        st.gpsHdop = acc.hdopN ? acc.hdop / acc.hdopN : null;
        st.gpsAccM = acc.accN ? acc.accM / acc.accN : null;
        st.gpsSats = acc.satsN ? acc.sats / acc.satsN : null;
        st.medianHeight = median(heights);
        st.hasGps = acc.hdopN > 0 || acc.accN > 0;
        st.hasWeight = S.some(function (s) { return s.weightG !== null; });

        // Abgeworfenes Gewicht: Median der stabilen Wägungen kurz vor der ersten und kurz nach
        // der letzten Saat-Phase. Ein Median über ~10 s glättet Beschleunigungsspitzen.
        if (firstSeed >= 0 && st.hasWeight) {
            st.weightStart = weightMedian(S, firstSeed - WEIGHT_WINDOW, firstSeed);
            st.weightEnd = weightMedian(S, lastSeed + 1, lastSeed + 1 + WEIGHT_WINDOW);
            if (st.weightStart !== null && st.weightEnd !== null) {
                st.weightDropped = Math.max(0, st.weightStart - st.weightEnd);
            }
        }

        var segs = buildSegments(S);
        st.lanes = segs.filter(function (g) { return g.cat === 'seed' && g.len >= MIN_LANE_M; }).length;
        return { stats: st, segments: segs };
    }

    // ---- Saatfläche ---------------------------------------------------------------------
    // Die Saatlinien werden mit halber Saatbreite gepuffert (Kapsel je Linienstück) und auf ein
    // Raster gelegt. Jede Zelle zählt einmal, Überschneidungen (innerhalb eines Logs und
    // zwischen Logs) fallen dadurch heraus. Zellgröße = Saatbreite / 20, mindestens 0,5 m.
    // Koordinaten: y = R * lat, x = R * lon * cos(Mitte des 0,5°-Breitenbands). Die Verzerrung
    // innerhalb eines Bands liegt unter 0,5 % der Fläche.

    var Y_OFF = 33554432;   // 2^25
    var X_OFF = 67108864;   // 2^26
    var ROW = 134217728;    // 2^27

    function cellSize(width) { return Math.max(0.5, width / 20); }

    function project(p) {
        var band = (Math.floor(p[0] / 0.5) + 0.5) * 0.5;
        return { x: R * rad(p[1]) * Math.cos(rad(band)), y: R * rad(p[0]) };
    }

    // x-Intervall, in dem a*x + b zwischen lo und hi liegt (null = leer)
    function linInterval(a, b, lo, hi) {
        if (Math.abs(a) < 1e-12) return (b >= lo && b <= hi) ? [-Infinity, Infinity] : null;
        var x1 = (lo - b) / a, x2 = (hi - b) / a;
        return x1 < x2 ? [x1, x2] : [x2, x1];
    }

    // Streifen der Breite 2r entlang P->Q. caps = Punkte, an denen zusätzlich ein Kreis mit
    // Radius r liegt (Knick innerhalb einer Saatbahn). Bahnanfang und -ende bleiben flach, weil
    // der Seeder nicht über Start- und Endpunkt hinaus streut. Streifen und Kreise sind konvex,
    // ihre Vereinigung schneidet jede Zeile in einem Intervall.
    // clips: Halbebenen {nx, ny, c} mit nx*x + ny*y >= c. Sie schneiden die Kreise an Anfang und
    // Ende der Bahn ab, damit ein Knick kurz vor dem Bahnende nicht über das Ende hinausragt.
    function rasterPiece(P, Q, r, cell, set, caps, clips) {
        var dx = Q.x - P.x, dy = Q.y - P.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
        var y0 = Math.min(P.y, Q.y) - r, y1 = Math.max(P.y, Q.y) + r;
        var iy0 = Math.ceil(y0 / cell - 0.5), iy1 = Math.floor(y1 / cell - 0.5);
        for (var iy = iy0; iy <= iy1; iy++) {
            var yc = (iy + 0.5) * cell;
            var lo = Infinity, hi = -Infinity;
            caps.forEach(function (C) {
                var h = r * r - (yc - C.y) * (yc - C.y);
                if (h < 0) return;
                var w = Math.sqrt(h), a = C.x - w, b = C.x + w;
                for (var k = 0; k < clips.length && a <= b; k++) {
                    var iv = linInterval(clips[k].nx, clips[k].ny * yc, clips[k].c, Infinity);
                    if (!iv) { a = 1; b = 0; break; }
                    a = Math.max(a, iv[0]); b = Math.min(b, iv[1]);
                }
                if (a <= b) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
            });
            if (L2 > 0) {
                var ti = linInterval(dx / L2, ((yc - P.y) * dy - P.x * dx) / L2, 0, 1);
                var ci = linInterval(dy, -P.x * dy - (yc - P.y) * dx, -r * L, r * L);
                if (ti && ci) {
                    var a = Math.max(ti[0], ci[0]), b = Math.min(ti[1], ci[1]);
                    if (a <= b) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
                }
            }
            if (lo > hi) continue;
            var ix0 = Math.ceil(lo / cell - 0.5), ix1 = Math.floor(hi / cell - 0.5);
            var rowKey = (iy + Y_OFF) * ROW;
            for (var ix = ix0; ix <= ix1; ix++) set.add(rowKey + ix + X_OFF);
        }
    }

    // Liefert ein Set belegter Rasterzellen für alle Saatlinien (Kategorie "seed") eines Logs.
    function coverage(segments, width) {
        var cell = cellSize(width), r = width / 2, set = new Set();
        var minStep = cell * 4;
        segments.forEach(function (g) {
            if (g.cat !== 'seed' || g.pts.length < 2) return;
            var all = g.pts.map(project);
            // Punkte ausdünnen (Mindestabstand), letzter Punkt bleibt immer erhalten
            var pts = [all[0]];
            for (var i = 1; i < all.length; i++) {
                var p = all[i], prev = pts[pts.length - 1];
                if (Math.hypot(p.x - prev.x, p.y - prev.y) >= minStep || i === all.length - 1) pts.push(p);
            }
            if (pts.length < 2) return;
            // Halbebenen hinter dem Bahnanfang und vor dem Bahnende
            var A = pts[0], A1 = pts[1], B = pts[pts.length - 1], B1 = pts[pts.length - 2];
            var clips = [
                { nx: A1.x - A.x, ny: A1.y - A.y, c: (A1.x - A.x) * A.x + (A1.y - A.y) * A.y },
                { nx: B1.x - B.x, ny: B1.y - B.y, c: (B1.x - B.x) * B.x + (B1.y - B.y) * B.y }
            ];
            for (var j = 1; j < pts.length; j++) {
                // Kreis am Endpunkt nur, wenn dort die Bahn weitergeht (Knick)
                var caps = j < pts.length - 1 ? [pts[j]] : [];
                rasterPiece(pts[j - 1], pts[j], r, cell, set, caps, clips);
            }
        });
        return { cells: set, cell: cell, areaM2: set.size * cell * cell };
    }

    // Vereinigte Fläche mehrerer Coverage-Sets (gleiche Saatbreite vorausgesetzt).
    function unionArea(covs) {
        if (!covs.length) return 0;
        if (covs.length === 1) return covs[0].areaM2;
        var biggest = covs.reduce(function (a, b) { return a.cells.size >= b.cells.size ? a : b; });
        var extra = new Set();
        covs.forEach(function (c) {
            if (c === biggest) return;
            c.cells.forEach(function (k) { if (!biggest.cells.has(k)) extra.add(k); });
        });
        return (biggest.cells.size + extra.size) * biggest.cell * biggest.cell;
    }

    // ---- Aggregation über mehrere Logs ---------------------------------------------------
    function aggregate(logs, width) {
        var a = {
            flights: logs.length, flightTime: 0, seedTime: 0, emptyTime: 0,
            dist: 0, seedDist: 0, emptyDist: 0, transferDist: 0, lanes: 0,
            weightDropped: null, weightLogs: 0,
            areaM2: 0, grossM2: 0,
            targetRpm: null, measRpm: null, spreaderRpm: null, seedSpeed: null, maxSpeed: null,
            minHeight: null, minFront: null, gpsHdop: null, gpsAccM: null, hasGps: false,
            drones: [], start: null, end: null
        };
        var w = { tRpm: 0, tRpmT: 0, mRpm: 0, mRpmT: 0, sp: 0, spT: 0, spd: 0, spdT: 0, hd: 0, hdT: 0, ac: 0, acT: 0 };
        logs.forEach(function (l) {
            var s = l.stats;
            a.flightTime += s.flightTime; a.seedTime += s.seedTime; a.emptyTime += s.emptyTime;
            a.dist += s.dist; a.seedDist += s.seedDist; a.emptyDist += s.emptyDist;
            a.transferDist += s.transferDist; a.lanes += s.lanes;
            if (s.weightDropped !== null) { a.weightDropped = (a.weightDropped || 0) + s.weightDropped; a.weightLogs++; }
            if (s.targetRpm !== null) { w.tRpm += s.targetRpm * s.seedTime; w.tRpmT += s.seedTime; }
            if (s.measRpm !== null) { w.mRpm += s.measRpm * s.seedTime; w.mRpmT += s.seedTime; }
            if (s.spreaderRpm !== null) { w.sp += s.spreaderRpm * s.flightTime; w.spT += s.flightTime; }
            if (s.seedSpeed !== null) { w.spd += s.seedSpeed * s.seedTime; w.spdT += s.seedTime; }
            if (s.gpsHdop !== null) { w.hd += s.gpsHdop * s.flightTime; w.hdT += s.flightTime; }
            if (s.gpsAccM !== null) { w.ac += s.gpsAccM * s.flightTime; w.acT += s.flightTime; }
            if (s.hasGps) a.hasGps = true;
            if (s.maxSpeed !== null && (a.maxSpeed === null || s.maxSpeed > a.maxSpeed)) a.maxSpeed = s.maxSpeed;
            if (s.minHeight && (!a.minHeight || s.minHeight.v < a.minHeight.v)) a.minHeight = s.minHeight;
            if (s.minFront && (!a.minFront || s.minFront.v < a.minFront.v)) a.minFront = s.minFront;
            if (l.meta.droneId && a.drones.indexOf(l.meta.droneId) < 0) a.drones.push(l.meta.droneId);
            if (s.start !== null && (a.start === null || s.start < a.start)) a.start = s.start;
            if (s.end !== null && (a.end === null || s.end > a.end)) a.end = s.end;
        });
        a.targetRpm = w.tRpmT ? w.tRpm / w.tRpmT : null;
        a.measRpm = w.mRpmT ? w.mRpm / w.mRpmT : null;
        a.spreaderRpm = w.spT ? w.sp / w.spT : null;
        a.seedSpeed = w.spdT ? w.spd / w.spdT : null;
        a.gpsHdop = w.hdT ? w.hd / w.hdT : null;
        a.gpsAccM = w.acT ? w.ac / w.acT : null;
        a.grossM2 = a.seedDist * width;
        a.areaM2 = unionArea(logs.map(function (l) { return l.coverage; }).filter(Boolean));
        return a;
    }

    return { compute: compute, coverage: coverage, aggregate: aggregate, category: category };
})();
