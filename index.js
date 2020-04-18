const express = require('express')
const client = require('prom-client');

const Registry = client.Registry;
const register = new Registry();

const EXPIRE_HOURS = 6;

var app = express();
app.use(express.json());

let cache = {};

const gauge = new client.Gauge({
  name: 'gitlab_pipeline_duration',
  help: 'Duration Pipelines',
  labelNames: ['path_with_namespace', 'ref']
});

register.registerMetric(gauge);

function addToCache(id, entry) {
    let expireTime = new Date();
    expireTime.setHours(expireTime.getHours() + EXPIRE_HOURS);

    cache[id] = {
        expireTime,
        data: entry,
    };
}

function expireCache() {
    let today = new Date();

    for (let [key, value] of Object.entries(cache)) {
        if (value.expireTime < today) {
            delete cache[key];
        }
    }
}

app.get('/', function(request, response){
    register.resetMetrics()
    for (let [key, value] of Object.entries(cache)) {
        gauge.set({ 
            path_with_namespace: value.data.path_with_namespace,
            ref: value.data.pipeline.ref
        }, 1);
    }

    response.send(register.metrics());
});

app.post('/', function(request, response){
    let d = request.body;

    const id = d.object_attributes.id;
    if (d.object_attributes.finished_at) {
        if (cache.hasOwnProperty(id)) {
            delete cache[id];
        }

        return;
    }

    addToCache(id, {
        path_with_namespace: d.project.path_with_namespace,
        pipeline: d.object_attributes,
    });

    response.send('ok');
});

app.listen(3000);

setInterval(expireCache, 1000);
