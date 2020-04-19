const express = require('express')
const client = require('prom-client');

const Registry = client.Registry;
const register = new Registry();

const EXPIRE_HOURS = 6;

var app = express();
app.use(express.json());

let cache = {};

const pipelineDurationGauge = new client.Gauge({
    name: 'gitlab_pipeline_duration',
    help: 'Duration Pipelines in milliseconds',
    labelNames: ['path_with_namespace', 'ref']
});

const pipelineStatusGauge = new client.Gauge({
    name: 'gitlab_pipeline_status',
    help: 'Status Pipelines',
    labelNames: ['path_with_namespace', 'ref']
});

const jobDurationGauge = new client.Gauge({
    name: 'gitlab_job_duration',
    help: 'Duration jobs in milliseconds',
    labelNames: ['path_with_namespace', 'ref', 'name', 'runner']
});

const jobStatusGauge = new client.Gauge({
    name: 'gitlab_job_status',
    help: 'Status jobs',
    labelNames: ['path_with_namespace', 'ref', 'name', 'runner']
});

register.registerMetric(pipelineDurationGauge);
register.registerMetric(pipelineStatusGauge);
register.registerMetric(jobDurationGauge);
register.registerMetric(jobStatusGauge);

function statusToNum(stat) {
    return {
        running: 0,
        pending: 1,
        success: 2,
        failed: 3,
        canceled: 4,
        skipped: 5,
    }[stat];
}

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

function addJob(job) {
    let runner = 'unknown';
    if (job.runner) {
        runner = job.runner.description;
    }

    const labels = {
        path_with_namespace: job.project_name.replace(' ', ''),
        ref: job.ref,
        name: job.build_name,
        runner: runner,
    };

    const now = new Date();
    const then = new Date(job.build_started_at);

    jobStatusGauge.set(labels, statusToNum(job.build_status));
    jobDurationGauge.set(labels, now.getTime() - then.getTime());
}

function addPipeline(pipeline) {
    const labels = {
        path_with_namespace: pipeline.project.path_with_namespace,
        ref: pipeline.object_attributes.ref,
    };

    const now = new Date();
    const then = new Date(pipeline.object_attributes.created_at);

    pipelineStatusGauge.set(labels, statusToNum(pipeline.object_attributes.status));
    pipelineDurationGauge.set(labels, now.getTime() - then.getTime());
}

app.get('/', function(request, response){
    register.resetMetrics()

    for (let [key, value] of Object.entries(cache)) {
        if (value.data.object_kind === 'build') {
            addJob(value.data);
        }

        if (value.data.object_kind === 'pipeline') {
            addPipeline(value.data);
        }
    }

    response.send(register.metrics());
});

app.post('/', function(request, response){
    let d = request.body;
    let id = null;

    if (d.object_kind === 'build') {
        id = d.build_id;

        if (d.build_finished_at) {
            if (cache.hasOwnProperty(id)) {
                delete cache[id];
            }

            return;
        }
    }

    if (d.object_kind === 'pipeline') {
        id = d.object_attributes.id;

        if (d.object_attributes.finished_at) {
            if (cache.hasOwnProperty(id)) {
                delete cache[id];
            }

            return;
        }
    }

    if (id !== null) {
        addToCache(id, d);
    }

    return response.send('ok');
});

app.listen(3000);

setInterval(expireCache, 1000);
