// Log-Parser: erkennt das Format einer Log-Datei und liefert ein einheitliches Sample-Format.
//
// Unterstützte Formate:
//   companion: Skyseed-Companion-Log (flight_*.jsonl), eine JSON-Zeile pro Sample, dazu
//              Ereigniszeilen mit "event" (flight_start, flight_end).
//   legacy:    alter Seed-Log als JSON-Array (Einträge mit position/timestamp/seeder.status).
//
// Normalisiertes Sample (Felder, die ein Format nicht kennt, sind null):
//   t (ms seit Epoch), lat, lon, alt, relAlt, speed, mode, armed, inAir,
//   seeding (Seeder fördert), empty (Behälter als leer gemeldet),
//   targetRpm, measRpm, spreaderRpm, weightG, weightOk, heightCm, frontCm,
//   gpsHdop, gpsAccM, gpsSats, missionSeq, missionCount, seederStatus

var LogParser = (function () {

    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        var n = Number(v);
        return isFinite(n) ? n : null;
    }

    function validPos(lat, lon) {
        return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
            !(lat === 0 && lon === 0);
    }

    // Companion-ts hat nur Sekundenauflösung: mehrere Samples tragen denselben Zeitstempel.
    // Sie werden gleichmäßig über das Intervall bis zum nächsten Zeitstempel verteilt
    // (höchstens über 1 s), damit Zeit- und Geschwindigkeitswerte nicht springen.
    function spreadSampleTimes(samples) {
        var i = 0;
        while (i < samples.length) {
            var j = i;
            while (j + 1 < samples.length && samples[j + 1].t === samples[i].t) j++;
            var n = j - i + 1;
            if (n > 1) {
                var next = j + 1 < samples.length ? samples[j + 1].t : samples[i].t + 1000;
                var span = Math.min(Math.max(next - samples[i].t, 0), 1000);
                for (var k = 0; k < n; k++) samples[i + k].t = samples[i].t + span * k / n;
            }
            i = j + 1;
        }
    }

    function parseCompanion(lines) {
        var meta = { format: 'companion', flightId: null, droneId: null, version: null, start: null, end: null };
        var samples = [];
        lines.forEach(function (d) {
            if (d.event) {
                if (d.event === 'flight_start') {
                    meta.flightId = d.flight_id || null;
                    meta.droneId = d.drone_id || null;
                    meta.version = d.companion_version || null;
                    meta.start = d.started || null;
                } else if (d.event === 'flight_end') {
                    meta.end = d.ended || null;
                }
                return;
            }
            if (!d.pos || !d.ts) return;
            var lat = num(d.pos.lat), lon = num(d.pos.lon);
            if (!validPos(lat, lon)) return;
            var t = Date.parse(d.ts);
            if (!isFinite(t)) return;
            var dr = d.drone || {}, se = d.seeder || {}, sp = d.spreader || {};
            var w = d.weight || {}, ra = d.radar || {}, gps = d.gps || {};
            var landed = num(dr.landed_state);
            var targetRpm = num(se.target_rpm);
            // front_cm_raw = 0 heißt "kein Echo", dann ist der gefilterte Wert kein Messwert.
            var frontCm = ra.front_cm_raw === 0 ? null : num(ra.front_cm);
            var heightCm = ra.height_cm_raw === 0 ? null : num(ra.height_cm);
            samples.push({
                t: t,
                lat: lat, lon: lon,
                alt: num(d.pos.alt_m), relAlt: num(d.pos.rel_alt_m),
                speed: num(d.gnd_speed),
                mode: dr.mode ? String(dr.mode).toUpperCase() : null,
                armed: dr.armed === true,
                // MAV_LANDED_STATE: 1 am Boden, 2 in der Luft, 3 Start, 4 Landung
                inAir: landed !== null ? (landed >= 2 && landed <= 4) : dr.armed === true,
                // Seeder fördert genau dann, wenn eine Soll-Drehzahl anliegt (AUTO mit auto_on
                // oder manuell eingeschaltet). meas_rpm hält nach dem Abschalten den letzten Wert.
                seeding: targetRpm !== null && targetRpm > 0,
                empty: se.empty === 'empty',
                targetRpm: targetRpm,
                measRpm: num(se.meas_rpm),
                spreaderRpm: num(sp.target_rpm),
                weightG: num(w.grams),
                weightOk: w.grams !== undefined && w.fault !== true && (w.state === undefined || w.state === 'stable'),
                heightCm: heightCm,
                frontCm: frontCm,
                gpsHdop: num(gps.hdop),
                gpsAccM: num(gps.h_acc_m),
                gpsSats: num(gps.satellites),
                missionSeq: num(dr.mission_seq),
                missionCount: num(dr.mission_count),
                seederStatus: se.status || null
            });
        });
        samples.sort(function (a, b) { return a.t - b.t; });
        spreadSampleTimes(samples);
        return { meta: meta, samples: samples };
    }

    function parseLegacy(arr) {
        var meta = { format: 'legacy', flightId: null, droneId: null, version: null, start: null, end: null };
        var samples = [];
        arr.forEach(function (p) {
            if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return; } }
            if (!p || !p.position || !p.timestamp) return;
            var pos = p.position;
            var lat = num(pos.lat !== undefined ? pos.lat : pos.latitude);
            var lon = num(pos.long !== undefined ? pos.long : (pos.longitude !== undefined ? pos.longitude : pos.lng));
            if (!validPos(lat, lon)) return;
            var t = Date.parse(p.timestamp);
            if (!isFinite(t)) return;
            if (meta.flightId === null && p.id !== undefined) meta.flightId = String(p.id);
            var mode = String((p.drone && p.drone.mode) || p.mode || '').toUpperCase() || null;
            // Format-Kompatibilität: neues Format drone.armed, altes Format drone.armedState
            var armedRaw = p.drone ? (p.drone.armed !== undefined ? p.drone.armed : p.drone.armedState) : p.armedState;
            var armed = armedRaw === true || armedRaw === 'true';
            var seederOn = !!(p.seeder && p.seeder.status === 'on');
            var rpm = p.seeder ? num(p.seeder.rpm || p.seeder.speedSetting) : null;
            samples.push({
                t: t, lat: lat, lon: lon, alt: null, relAlt: null, speed: null,
                mode: mode, armed: armed, inAir: armed,
                // Bisherige Regel des Analyzers: Saat nur bei Seeder "on" im Modus AUTO
                seeding: seederOn && mode === 'AUTO',
                empty: false,
                targetRpm: rpm, measRpm: null, spreaderRpm: null,
                weightG: null, weightOk: false, heightCm: null, frontCm: null,
                gpsHdop: null, gpsAccM: null, gpsSats: null,
                missionSeq: null, missionCount: null, seederStatus: p.seeder ? p.seeder.status : null
            });
        });
        samples.sort(function (a, b) { return a.t - b.t; });
        return { meta: meta, samples: samples };
    }

    // Erkennt das Format am Inhalt (nicht an der Endung) und gibt {meta, samples} zurück.
    function parse(text) {
        var trimmed = text.replace(/^﻿/, '').trim();
        if (!trimmed) throw new Error('Datei ist leer');
        if (trimmed[0] === '[') {
            var arr = JSON.parse(trimmed);
            if (!Array.isArray(arr)) throw new Error('Unbekanntes JSON-Format');
            var objs = arr.map(function (p) {
                if (typeof p !== 'string') return p;
                try { return JSON.parse(p); } catch (e) { return null; }
            }).filter(Boolean);
            // Ein Array aus Companion-Datensätzen wird wie JSONL behandelt
            if (objs.some(function (o) { return o.pos && o.ts; })) return parseCompanion(objs);
            return parseLegacy(objs);
        }
        var lines = [];
        var bad = 0;
        trimmed.split(/\r?\n/).forEach(function (line) {
            line = line.trim();
            if (!line) return;
            try { lines.push(JSON.parse(line)); } catch (e) { bad++; }
        });
        if (!lines.length) throw new Error('Keine lesbaren JSON-Zeilen');
        var res = parseCompanion(lines);
        res.meta.badLines = bad;
        return res;
    }

    return { parse: parse };
})();
