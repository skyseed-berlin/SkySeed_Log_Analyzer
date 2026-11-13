// Oberfläche für Cloud-Logs (Seitenleiste): Liste, Suche, Datumsfilter, Auswahl nach Fläche/Block.
// Daten und Geometrie stehen in js/cloud-data.js. Nutzt Funktionen aus index.html
// (loadFiles, activeLogs, esc, fmtDateTime, fmtDur, showStatus), die zum Aufrufzeitpunkt vorhanden sind.

var CloudUI = (function () {
    'use strict';

    var MAX_ROWS = 300;
    var state = {
        loggedIn: false,
        flights: null,      // null = noch nicht geladen
        blocks: null,       // null = noch nicht geladen
        blocksError: null,
        assignment: {},
        areas: [],
        selectedBlocks: new Set(),
        selectedFlights: new Set(),
        text: '', from: '', to: '', drone: '', showTests: false,
        areaSearch: '',
        loading: false,
        error: null
    };
    var root = null;

    function init(el) {
        root = el;
        render();
    }

    function setSession(session) {
        // Nach Logout gilt user === null und isGuest false: ebenfalls nicht angemeldet
        state.loggedIn = !!(session && session.user && !session.isGuest);
        if (!state.loggedIn) {
            state.flights = null;
            state.blocks = null;
            state.selectedFlights.clear();
            state.selectedBlocks.clear();
        } else if (state.flights === null && !state.loading) {
            refresh();
        }
        render();
    }

    function refresh() {
        state.loading = true;
        state.error = null;
        render();
        var flightsP = CloudData.listFlights().then(function (f) { state.flights = f; });
        // Dashboard getrennt: ein Fehler dort darf die Flugliste nicht verhindern
        var blocksP = CloudData.loadBlocks(function (p) { return SkyseedAuth.fetchDashboard(p); })
            .then(function (b) { state.blocks = b; state.blocksError = null; })
            .catch(function (err) { state.blocks = []; state.blocksError = err.message || String(err); });
        return Promise.all([flightsP.catch(function (err) { state.error = err.message || String(err); state.flights = []; }), blocksP])
            .then(function () {
                state.areas = CloudData.groupByArea(state.blocks.filter(function (b) { return b.rings.length; }));
                state.assignment = CloudData.assign(state.flights, state.blocks);
            })
            .then(function () { state.loading = false; render(); });
    }

    // --- Hilfen ---

    function dayStart(value) {
        if (!value) return null;
        var p = value.split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]).getTime();
    }

    function dateLabel(f) {
        return new Date(f.started_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    function blockById(id) {
        for (var i = 0; i < state.blocks.length; i++) if (state.blocks[i].id === id) return state.blocks[i];
        return null;
    }

    function blockLabels(f) {
        return (state.assignment[f.flight_uid] || []).map(function (id) {
            var b = blockById(id);
            return b ? b.label : '';
        }).join(' ');
    }

    function visibleFlights() {
        return CloudData.filterFlights(state.flights || [], {
            text: state.text,
            from: dayStart(state.from),
            to: state.to ? dayStart(state.to) + 86400000 : null,
            drone: state.drone,
            showTests: state.showTests,
            blockIds: state.selectedBlocks,
            assignment: state.assignment,
            dateLabel: dateLabel,
            blockLabels: blockLabels
        });
    }

    function isLoaded(f) { return activeLogs.has(CloudData.fileName(f)); }

    function tagsFor(f) {
        var ids = state.assignment[f.flight_uid] || [];
        if (!ids.length) return '';
        var names = ids.slice(0, 2).map(function (id) { var b = blockById(id); return b ? esc(b.label) : ''; });
        var more = ids.length > 2 ? ' +' + (ids.length - 2) : '';
        return '<div class="cloud-tags" title="Kandidaten: Block liegt im Bereich des Flugs">' + names.join(' · ') + more + '</div>';
    }

    // --- Rendern ---

    function render() {
        if (!root) return;
        if (!state.loggedIn) {
            root.innerHTML = '<div class="hint cloud-hint">Hochgeladene Logs der Drohnen. Dafür ist eine Anmeldung nötig.</div>' +
                '<button id="cloud-login" class="btn btn-ghost btn-block">Anmelden für Cloud-Logs</button>';
            root.querySelector('#cloud-login').onclick = function () {
                SkyseedAuth.requireLogin('Für die Cloud-Logs bitte anmelden.');
            };
            return;
        }
        if (state.flights === null) {
            root.innerHTML = '<div class="empty-state">' + (state.loading ? 'Lade Flüge …' : 'Noch nicht geladen') + '</div>';
            return;
        }

        var drones = [];
        state.flights.forEach(function (f) { if (drones.indexOf(f.drone_id) === -1) drones.push(f.drone_id); });
        drones.sort();

        var html = '';
        if (state.error) html += '<div class="cloud-error">Flüge nicht ladbar: ' + esc(state.error) + '</div>';
        html += '<input id="cloud-text" class="form-control" type="search" placeholder="Suchen: Datum, Drohne, Fläche, Block" value="' + esc(state.text) + '">';
        html += '<div class="cloud-row"><label>von<input id="cloud-from" class="form-control" type="date" value="' + esc(state.from) + '"></label>' +
            '<label>bis<input id="cloud-to" class="form-control" type="date" value="' + esc(state.to) + '"></label></div>';
        html += '<div class="cloud-row"><label>Drohne<select id="cloud-drone" class="form-control"><option value="">alle</option>' +
            drones.map(function (d) { return '<option value="' + esc(d) + '"' + (d === state.drone ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') +
            '</select></label></div>';
        html += '<label class="switch-row"><input type="checkbox" id="cloud-tests"' + (state.showTests ? ' checked' : '') +
            '><span class="switch"></span><span>Testflüge (Simulator) zeigen</span></label>';
        html += areaPickerHtml();
        html += '<div id="cloud-list-wrap"></div>';
        html += '<div class="cloud-actions"><button id="cloud-load" class="btn btn-primary btn-block"></button>' +
            '<button id="cloud-refresh" class="btn btn-ghost btn-block"' + (state.loading ? ' disabled' : '') + '>' +
            (state.loading ? 'Aktualisiere …' : 'Aktualisieren') + '</button></div>';
        root.innerHTML = html;

        bindFilters();
        renderList();
    }

    function areaPickerHtml() {
        var n = state.selectedBlocks.size;
        var summary = n ? n + (n === 1 ? ' Block gewählt' : ' Blöcke gewählt') : 'alle Flächen und Blöcke';
        var h = '<details id="cloud-areas" class="cloud-areas"' + (state.areaOpen ? ' open' : '') + '><summary>Fläche / Block: ' + summary + '</summary>';
        if (state.blocksError) {
            h += '<div class="cloud-error">Dashboard nicht erreichbar: ' + esc(state.blocksError) + '</div>';
        } else if (!state.areas.length) {
            h += '<div class="empty-state">Keine Blöcke mit Geometrie im Dashboard</div>';
        } else {
            h += '<input id="cloud-area-search" class="form-control" type="search" placeholder="Fläche oder Block suchen" value="' + esc(state.areaSearch) + '">';
            h += '<div class="cloud-tree">';
            var q = state.areaSearch.trim().toLowerCase();
            state.areas.forEach(function (a) {
                var blocks = a.blocks.filter(function (b) { return !q || (a.name + ' ' + b.name).toLowerCase().indexOf(q) !== -1; });
                if (!blocks.length) return;
                var sel = blocks.filter(function (b) { return state.selectedBlocks.has(b.id); }).length;
                h += '<div class="cloud-area"><label class="cloud-area-head"><input type="checkbox" data-area="' + a.id + '"' +
                    (sel === blocks.length ? ' checked' : '') + (sel > 0 && sel < blocks.length ? ' data-partial="1"' : '') + '> ' + esc(a.name) + '</label>';
                blocks.forEach(function (b) {
                    h += '<label class="cloud-block"><input type="checkbox" data-block="' + b.id + '"' +
                        (state.selectedBlocks.has(b.id) ? ' checked' : '') + '> ' + esc(b.name) + '</label>';
                });
                h += '</div>';
            });
            h += '</div>';
            if (n) h += '<button id="cloud-areas-clear" class="btn btn-ghost btn-block">Auswahl aufheben</button>';
        }
        return h + '</details>';
    }

    function bindFilters() {
        function on(id, ev, fn) { var el = root.querySelector(id); if (el) el.addEventListener(ev, fn); }
        function keepFocus(id, fn) {
            return function (e) {
                fn(e);
                var pos = e.target.selectionStart;
                render();
                var el = root.querySelector(id);
                if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* type=search ok */ } }
            };
        }
        on('#cloud-text', 'input', keepFocus('#cloud-text', function (e) { state.text = e.target.value; }));
        on('#cloud-from', 'change', function (e) { state.from = e.target.value; render(); });
        on('#cloud-to', 'change', function (e) { state.to = e.target.value; render(); });
        on('#cloud-drone', 'change', function (e) { state.drone = e.target.value; render(); });
        on('#cloud-tests', 'change', function (e) { state.showTests = e.target.checked; render(); });
        on('#cloud-refresh', 'click', function () { refresh(); });
        on('#cloud-load', 'click', loadSelected);
        on('#cloud-areas', 'toggle', function (e) { state.areaOpen = e.target.open; });
        on('#cloud-area-search', 'input', keepFocus('#cloud-area-search', function (e) { state.areaSearch = e.target.value; state.areaOpen = true; }));
        on('#cloud-areas-clear', 'click', function () { state.selectedBlocks.clear(); state.areaOpen = true; render(); });

        root.querySelectorAll('input[data-partial]').forEach(function (el) { el.indeterminate = true; });
        root.querySelectorAll('input[data-block]').forEach(function (el) {
            el.addEventListener('change', function () {
                var id = +el.dataset.block;
                if (el.checked) state.selectedBlocks.add(id); else state.selectedBlocks.delete(id);
                state.areaOpen = true;
                render();
            });
        });
        root.querySelectorAll('input[data-area]').forEach(function (el) {
            el.addEventListener('change', function () {
                var area = state.areas.filter(function (a) { return String(a.id) === el.dataset.area; })[0];
                var q = state.areaSearch.trim().toLowerCase();
                area.blocks.forEach(function (b) {
                    if (q && (area.name + ' ' + b.name).toLowerCase().indexOf(q) === -1) return;
                    if (el.checked) state.selectedBlocks.add(b.id); else state.selectedBlocks.delete(b.id);
                });
                state.areaOpen = true;
                render();
            });
        });
    }

    function renderList() {
        var wrap = root.querySelector('#cloud-list-wrap');
        var list = visibleFlights();
        var selectable = list.filter(function (f) { return !isLoaded(f); });
        var allSel = selectable.length > 0 && selectable.every(function (f) { return state.selectedFlights.has(f.flight_uid); });
        var h = '<div class="cloud-list-head"><label><input type="checkbox" id="cloud-all"' + (allSel ? ' checked' : '') +
            (selectable.length ? '' : ' disabled') + '> alle zeigen (' + list.length + ' von ' + state.flights.length + ')</label></div>';
        h += '<div class="cloud-list">';
        if (!list.length) h += '<div class="empty-state">Keine Flüge für diesen Filter</div>';
        list.slice(0, MAX_ROWS).forEach(function (f) {
            var loaded = isLoaded(f);
            var auto = f.auto_seconds ? fmtDur(Number(f.auto_seconds)) + ' Auto' : '';
            h += '<label class="cloud-item' + (loaded ? ' loaded' : '') + '"><input type="checkbox" data-flight="' + f.flight_uid + '"' +
                (loaded ? ' disabled' : '') + (state.selectedFlights.has(f.flight_uid) ? ' checked' : '') + '>' +
                '<div><div class="cloud-item-title">' + dateLabel(f) + ' · Drohne ' + esc(f.drone_id) +
                (f.is_test ? ' <span class="cloud-badge">Test</span>' : '') +
                (f.complete ? '' : ' <span class="cloud-badge" title="Datei ohne Flugende (Absturz oder Stromausfall)">unvollständig</span>') +
                (loaded ? ' <span class="cloud-badge ok">geladen</span>' : '') + '</div>' +
                '<div class="log-meta">' + [auto, f.records + ' Samples'].filter(Boolean).join(' · ') + '</div>' + tagsFor(f) + '</div></label>';
        });
        if (list.length > MAX_ROWS) h += '<div class="hint">Erste ' + MAX_ROWS + ' von ' + list.length + '. Filter eingrenzen für weitere.</div>';
        h += '</div>';
        wrap.innerHTML = h;

        wrap.querySelector('#cloud-all').addEventListener('change', function (e) {
            selectable.forEach(function (f) {
                if (e.target.checked) state.selectedFlights.add(f.flight_uid); else state.selectedFlights.delete(f.flight_uid);
            });
            renderList();
        });
        wrap.querySelectorAll('input[data-flight]').forEach(function (el) {
            el.addEventListener('change', function () {
                if (el.checked) state.selectedFlights.add(el.dataset.flight); else state.selectedFlights.delete(el.dataset.flight);
                updateLoadButton();
            });
        });
        updateLoadButton();
    }

    function selectedList() {
        return (state.flights || []).filter(function (f) { return state.selectedFlights.has(f.flight_uid) && !isLoaded(f); });
    }

    function updateLoadButton() {
        var btn = root.querySelector('#cloud-load');
        if (!btn) return;
        var n = selectedList().length;
        btn.textContent = n ? n + (n === 1 ? ' Log laden' : ' Logs laden') : 'Logs zum Laden auswählen';
        btn.disabled = !n || state.loading;
    }

    function loadSelected() {
        var flights = selectedList();
        if (!flights.length) return;
        state.loading = true;
        var files = [];
        var failed = [];
        var chain = Promise.resolve();
        flights.forEach(function (f, i) {
            chain = chain.then(function () {
                showStatus('Lade aus der Cloud ' + (i + 1) + '/' + flights.length, 0);
                return CloudData.downloadFlight(f).then(function (file) { files.push(file); })
                    .catch(function (err) { failed.push(dateLabel(f) + ' (' + (err.message || err) + ')'); });
            });
        });
        chain.then(function () { return loadFiles(files); }).then(function () {
            flights.forEach(function (f) { state.selectedFlights.delete(f.flight_uid); });
            if (failed.length) alert('Nicht ladbar:\n' + failed.join('\n'));
        }).then(function () { state.loading = false; render(); });
    }

    // Wird nach jeder Änderung der geladenen Logs aufgerufen, damit "geladen" stimmt
    function onLogsChanged() {
        if (state.loggedIn && state.flights !== null && root && root.querySelector('#cloud-list-wrap')) renderList();
    }

    return { init: init, setSession: setSession, onLogsChanged: onLogsChanged };
})();
