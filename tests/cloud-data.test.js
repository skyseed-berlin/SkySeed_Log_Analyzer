// Tests für js/cloud-data.js (Geometrie, Zuordnung, Filter). Aufruf: node --test tests/
// Synthetische Daten, keine echten Logs.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/cloud-data.js');

const square = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[13, 52], [13.01, 52], [13.01, 52.01], [13, 52.01], [13, 52]]] } };
const triangle = { type: 'MultiPolygon', coordinates: [[[[14, 52], [14.01, 52], [14.01, 52.01], [14, 52]]]] };
const b1 = C.normalizeBlock({ id: 1, area: 5, project_area_name: 'Acker A', name: 'B1', geojson: square });
const b2 = C.normalizeBlock({ id: 2, area: 5, project_area_name: 'Acker A', index: 2, geojson: JSON.stringify(triangle) });
const bNone = C.normalizeBlock({ id: 3, area: 6, geojson: null });
const rect = (minLat, minLon, maxLat, maxLon) => ({ flight_uid: 'x', min_lat: minLat, min_lon: minLon, max_lat: maxLat, max_lon: maxLon });
const ids = (f, blocks) => C.blocksForFlight(f, blocks).map(b => b.id);

test('Block ohne Geometrie hat keine Ringe und wird nie zugeordnet', () => {
    assert.equal(bNone.rings.length, 0);
    assert.deepEqual(ids(rect(52, 13, 52.1, 13.1), [bNone]), []);
});

test('GeoJSON als String und als MultiPolygon wird gelesen', () => {
    assert.equal(b2.rings.length, 1);
    assert.equal(b2.name, 'Block 2');
});

test('Flug-Box liegt innen, umschließt, kreuzt oder liegt außerhalb', () => {
    assert.deepEqual(ids(rect(52.002, 13.002, 52.004, 13.004), [b1]), [1]);
    assert.deepEqual(ids(rect(51.9, 12.9, 52.1, 13.1), [b1]), [1]);
    assert.deepEqual(ids(rect(52.005, 12.99, 52.006, 13.02), [b1]), [1]);
    assert.deepEqual(ids(rect(53, 13, 53.1, 13.1), [b1]), []);
});

test('Box im Bounding-Box-Bereich, aber außerhalb des Polygons', () => {
    // Dreieck 14/52, 14.01/52, 14.01/52.01: die linke obere Ecke der Box liegt außerhalb
    assert.deepEqual(ids(rect(52.0095, 14.0001, 52.0099, 14.0004), [b2]), []);
    assert.deepEqual(ids(rect(52.001, 14.005, 52.002, 14.008), [b2]), [2]);
});

test('Flug ohne Bounding Box wird keinem Block zugeordnet', () => {
    assert.deepEqual(ids({ flight_uid: 'x', min_lat: null }, [b1]), []);
});

test('Gruppierung nach Fläche', () => {
    const groups = C.groupByArea([b1, b2]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].blocks.map(b => b.id), [1, 2]);
});

const flights = [
    { flight_uid: 'a', drone_id: '3', flight_id: '20261116_100000Z', started_at: '2026-11-16T10:00:00Z', is_test: false },
    { flight_uid: 'b', drone_id: '9', flight_id: '20261115_090000Z', started_at: '2026-11-15T09:00:00Z', is_test: true }
];
const base = { dateLabel: f => f.started_at, assignment: { a: [1] } };

test('Filter: Testflüge, Text, Datum, Drohne, Block', () => {
    const n = o => C.filterFlights(flights, Object.assign({}, base, o)).length;
    assert.equal(n({ showTests: false }), 1);
    assert.equal(n({ showTests: true }), 2);
    assert.equal(n({ showTests: true, text: '1115' }), 1);
    assert.equal(n({ showTests: true, from: Date.parse('2026-11-16T00:00:00Z') }), 1);
    assert.equal(n({ showTests: true, drone: '9' }), 1);
    assert.equal(n({ showTests: true, blockIds: new Set([1]) }), 1);
    assert.equal(n({ showTests: true, blockIds: new Set([2]) }), 0);
});

test('Dateiname entspricht dem Companion-Dateinamen', () => {
    assert.equal(C.fileName({ flight_id: '20261116_100000Z' }), 'flight_20261116_100000Z.jsonl');
});

test('Zuordnung einer Flugbahn nach Punktanteil', () => {
    // 8 Punkte in Block 1, 2 Punkte weit weg
    const pts = [];
    for (let i = 0; i < 8; i++) pts.push([52.002 + i * 0.0005, 13.005]);
    pts.push([53, 13], [53.1, 13.1]);
    const res = C.blocksForTrack(pts, [b1, b2]);
    assert.deepEqual(res.map(r => r.block.id), [1]);
    assert.equal(res[0].share, 0.8);
    // unter der Mindestschwelle fällt der Block heraus
    const far = []; for (let i = 0; i < 40; i++) far.push([53, 13]);
    assert.deepEqual(C.blocksForTrack(far.concat([pts[0]]), [b1]).map(r => r.block.id), []);
    assert.deepEqual(C.blocksForTrack([], [b1]), []);
});
