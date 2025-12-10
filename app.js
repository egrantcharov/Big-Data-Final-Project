'use strict';
const http = require('http');
var assert = require('assert');
const express= require('express');
const app = express();
const mustache = require('mustache');
const filesystem = require('fs');
const path = require('path');
require('dotenv').config()
const port = Number(process.argv[2]);
const hbase = require('hbase')

const url = new URL(process.argv[3]);
console.log(url)
var hclient = hbase({
	host: url.hostname,
	path: url.pathname ?? "/",
	port: url.port, // http or https defaults
	protocol: url.protocol.slice(0, -1), // Don't want the colon
	encoding: 'latin1'
});

const TAXI_CSV_PATH = process.env.TAXI_CSV || path.join(__dirname, 'data', 'taxi_live_stats.csv');

function counterToNumber(c) {
	return Number(Buffer.from(c, 'latin1').readBigInt64BE());
}
function rowToMap(row) {
	var stats = {}
	row.forEach(function (item) {
		stats[item['column']] = counterToNumber(item['$'])
	});
	return stats;
}
/*
hclient.table('weather_delays_by_route').row('ORDAUS').get((error, value) => {
	console.info(rowToMap(value))
	console.info(value)
})


hclient.table('weather_delays_by_route').row('ORDAUS').get((error, value) => {
	console.info(rowToMap(value))
	console.info(value)
})
*/



app.use(express.static('public'));
app.get('/delays.html', async function (req, res) {
    const origin = (req.query['origin'] || '').toUpperCase().trim();
    const dest = (req.query['dest'] || '').toUpperCase().trim();

    function counterToNumber(c) {
        return Number(Buffer.from(c, 'latin1').readBigInt64BE());
    }

    function rowToMap(row) {
        const stats = {};
        (row || []).forEach(item => {
            stats[item['column']] = counterToNumber(item['$']);
        });
        return stats;
    }

    // Helper: render table with a common template
    function renderWith(stats, origin, dest) {
        const template = filesystem.readFileSync("result.mustache").toString();

        function weather_delay(weather) {
            const flights = stats[`delay:${weather}_flights`] || 0;
            const delays = stats[`delay:${weather}_delays`] || 0;
            if (flights === 0) return " - ";
            return (delays / flights).toFixed(1);
        }

        const html = mustache.render(template, {
            origin,
            dest,
            hasDest: !!dest,
            clear_dly: weather_delay("clear"),
            fog_dly: weather_delay("fog"),
            rain_dly: weather_delay("rain"),
            snow_dly: weather_delay("snow"),
            hail_dly: weather_delay("hail"),
            thunder_dly: weather_delay("thunder"),
            tornado_dly: weather_delay("tornado")
        });

        res.send(html);
    }

    // Treat as airport code only if exactly 3 A–Z letters.
    const isIATA = (s) => /^[A-Z]{3}$/.test(s);
// Case A: route (origin + dest are valid IATA)
    if (isIATA(origin) && isIATA(dest)) {
        const routeKey = origin + dest;
        hclient.table('weather_delays_by_route').row(routeKey).get(function (err, cells) {
            if (err) return res.status(500).send(String(err));
            return renderWith(rowToMap(cells), origin, dest);
        });
        return;
    }

// Case B: origin-only (origin is IATA; dest missing/invalid)
    if (isIATA(origin)) {
        hclient.table('weather_delays_by_route').scan(
            {filter: {type: "PrefixFilter", value: origin}, maxVersions: 1},
            function (err, cells) {
                if (err) return res.status(500).send(String(err));
                const totals = Object.create(null);
                (cells || []).forEach(c => {
                    const col = c.column;
                    const val = counterToNumber(c.$);
                    totals[col] = (totals[col] || 0) + val;
                });
                return renderWith(totals, origin, null); // dest null => origin-only title
            }
        );
        return;
    }


    return res.status(400).send("Provide a 3-letter origin (and optional 3-letter dest).");
});

// Simple API to expose taxi_live_stats.csv as JSON
app.get('/api/taxi/live_stats', function (req, res) {
    filesystem.readFile(TAXI_CSV_PATH, 'utf8', function (err, data) {
        if (err) {
            console.error('Error reading taxi_live_stats CSV:', err);
            res.status(500).json({ error: String(err) });
            return;
        }

        const trimmed = data.trim();
        if (!trimmed) {
            res.json({ header: [], rows: [] });
            return;
        }

        const lines = trimmed.split('\n');
        if (lines.length === 0) {
            res.json({ header: [], rows: [] });
            return;
        }

// Our CSV has NO header row; it’s just data.
// Format per line (from your Spark job):
//   0: window_start (e.g., "2015-01-14 13:40:00")
//   1: window_end   (e.g., "2015-01-14 13:50:00")
//   2: count        (e.g., "22")
//   3: metric1      (e.g., "1.04545...")
//   4: metric2      (e.g., "2.71363...")

        const header = ['window_start', 'window_end', 'count', 'metric1', 'metric2'];

        const rows = lines.map(line => {
            const [start, end, countStr, m1Str, m2Str] = line.split(',');

            return {
                window_start: start,
                window_end: end,
                count: Number(countStr) || 0,
                metric1: Number(m1Str) || 0,
                metric2: Number(m2Str) || 0
            };
        });

        res.json({ header, rows });
    });
});

app.listen(port);
