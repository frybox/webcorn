import * as Comlink from "comlink";

function serviceWorkerEndPoint() {
    const serviceWorkerContainer = navigator.serviceWorker;
    if ('controller' in serviceWorkerContainer) {
        const serviceWorker = serviceWorkerContainer.controller;
        return {
            addEventListener: serviceWorkerContainer.addEventListener.bind(serviceWorkerContainer),
            removeEventListener: serviceWorkerContainer.removeEventListener.bind(serviceWorkerContainer),
            postMessage: serviceWorker.postMessage.bind(serviceWorker)
        };
    }
}

const webcornEndPoint = serviceWorkerEndPoint();

const response = await fetch(new URL('config', location.href));
const webcornConfig = await response.json();

class WebcornWorker {
    constructor(projectRoot, appSpec) {
        this.projectRoot = projectRoot;
        this.appSec = appSpec;
    }

    async start() {
        this.worker = new Worker('./worker.js', {type: 'module'});
        this.wrapper = Comlink.wrap(this.worker);
        this.isWsgi = await this.wrapper.start(this.projectRoot, this.appSpec);
        this.maxCount = this.isWsgi ? 1 : 100;
        this.activeCount = 0;
    }

    async handleRequest(request) {
        const response = await this.wrapper.handleRequest(request);
        return response;
    }

    retain() {
        if (this.activeCount < this.maxCount) {
            this.activeCount ++;
            return true;
        } else {
            return false;
        }
    }

    release() {
        if (this.activeCount > 0) {
            this.activeCount --;
        }
    }
}

const workers = [];

const retainWorker = async () => {
    let worker
    for (worker of workers) {
        if (worker.retain()) {
            return worker;
        }
    }
    worker = new WebcornWorker(webcornConfig.projectRoot, webcornConfig.appSpec);
    await worker.start();
    workers.push(worker);
    worker.retain();
    return worker;
};

const handleRequest = async (request) => {
    let worker;
    try {
        worker = await retainWorker();
        const response = await worker.handleRequest(request);
        return response;
    } finally {
        if (worker) {
            worker.release();
        }
    }
}

Comlink.expose({ handleRequest }, webcornEndPoint);