import * as Comlink from "comlink";

//import { loadPyodide } from "./pyodide.mjs";
// 静态加载pyodide.asm.js，否则在loadPyodide时将会动态加载，在module类型service worker中不支持动态加载
//import "./pyodide.asm.js";

console.log(`enter service-worker.js from ${location}`);

console.log(self.registration.scope);

const printClients = () => {
    clients.matchAll().then(allClients => {
        console.log('all clients:');
        for (const client of allClients) {
            console.log(client);
        }
    });
}

printClients();

self.addEventListener('install', e => {
    console.log("installing service worker")
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    console.log("activating service worker")
    self.clients.claim();
});

let pyodide;
let app;
let is_wsgi;


const buildEnviron = async (request) => {
    const url = new URL(request.url);

    const method = url.method;
    const scheme = url.protocol.slice(0, -1);
    const hostname = url.hostname;
    const port = url.port;
    const path = url.pathname;
    const query_string = url.search ? url.search.slice(1) : '';
    const headers = {};
    for (const [k, v] of request.headers) {
        if (k in headers) {
            headers[k] += ','+v;
        } else {
            headers[k] = v;
        }
    }
    const bytes = await request.bytes();

    const environ = {
        REQUEST_METHOD: method,
        SCRIPT_NAME: '',
        PATH_INFO: pathname,
        QUERY_STRING: query_string,
        SERVER_NAME: hostname,
        SERVER_PORT: port,
        SERVER_PROTOCOL: 'HTTP/1.1',
        //'wsgi.version': (1, 0),
        'wsgi.url_scheme': scheme,
        //'wsgi.input': BytesIO(bytes),
        //'wsgi.errors': StringIO(),
        'wsgi.multithread': false,
        'wsgi.multiprocess': false,
        'wsgi.run_once': false,
    };
    if (headers.has('content-type')) {
        environ.CONTENT_TYPE = headers.get('content-type');
    } else {
        environ.CONTENT_TYPE = 'text/plain';
    }
    if (headers.has('content-length')) {
        environ.CONTENT_LENGTH = headers.get('content-length');
    } else {
        environ.CONTENT_LENGTH = ''
    }

    for (const [k, v] of headers) {
        const k1 = k.replace(/-/g, '_').toUpperCase();
        if (k1 in environ) continue;
        const k2 = `HTTP_${k1}`;
        if (k2 in environ) {
            environ[k2] += ','+v;
        } else {
            environ[k2] = v;
        }
    }
    return environ;
}

const buildScope = async (request) => {
    const url = new URL(request.url);
    const method = url.method;
    const scheme = url.protocol.slice(0, -1);
    const hostname = url.hostname;
    const port = url.port;
    const path = url.pathname;
    const query_string = url.search ? url.search.slice(1) : '';
    const headers = {};
    for (const [k, v] of request.headers) {
        if (k in headers) {
            headers[k] += ','+v;
        } else {
            headers[k] = v;
        }
    }
    const bytes = await request.bytes();

    const version = '3.0';
    const spec_version = '2.3';
    const state = {};
    const scope = {
        type: 'http',
        asgi: {version, spec_version},
        http_version: '1.1',
        method,
        scheme,
        path, //转为bytes
        raw_path: path, //转为bytes
        query_string, //转为bytes
        root_path: '',
        headers,
        client: ['127.0.0.1', 0],
        server: [hostname, port],
        state,
    }
    return scope;
}

const pingForever = async (w) => {
    await w.ping();

    setTimeout(()=>pingForever(w), 5000);
}

const handleFetch = async e => {
    console.log("fetch received by service worker");
    const request = e.request;
    const url = new URL(request.url);
    const method = url.method;
    const scheme = url.protocol.slice(0, -1);
    const hostname = url.hostname;
    const port = url.port;
    const path = url.pathname;
    const query_string = url.search ? url.search.slice(1) : '';
    const headers = {};
    for (const [k, v] of request.headers) {
        if (k in headers) {
            headers[k] += ','+v;
        } else {
            headers[k] = v;
        }
    }
    const body = await request.arrayBuffer();

    console.log(`service worker: received ${path}`)

    if (path.startsWith('/webcorn/') && path.endsWith('/__start')){
        const app = path.slice('/webcorn/'.length, -'/__start'.length);
        console.log(`service worker: register webcorn server ${app}`);
        printClients();
    } else if (path === '/webcorn/webcorn.mjs') {
        console.log(`service worker: start webcorn server ${app}`);
        printClients();
        return await fetch(path);
    }

    setTimeout(printClients, 1000);

    return new Response('OKK', {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        }
    });

    
    /*
    if (!worker) {
        const scope = registration.scope;
        const root_path = new URL(scope).pathname;
        worker = new Worker('/webcorn.js', {type: 'module'});
        worker = Comlink.wrap(worker);
        worker.start(root_path);
        await pingForever(worker);
    }
    let data = {
        method,
        scheme,
        hostname,
        port,
        path,
        query_string,
        headers,
        body
    };
    data = Comlink.transfer(data, [data.body]);
    result = await worker.run(data);
    return new Response(result.body, {
        status: result.status,
        headers: result.headers
    });
    */
}

const handleFetch0 = async e => {
    console.log("fetch received by service worker");
    const request = e.request;
    let begin;
    let end;
    let app;
    let is_wsgi;
    if (!pyodide) {
        begin = performance.now();
        console.log("loading pyodide");
        pyodide = await loadPyodide();
        end = performance.now();
        console.log(`loaded pyodide successfully in ${(end-begin).toFixed(2)}ms`);
    }
    if (!app) {
        const wsgi = await fetch('/wsgi.py');
        const text = await wsgi.text();
        await pyodide.runPythonAsync(text);
        app = pyodide.globals.get('app');
        is_wsgi = pyodide.globals.get('is_wsgi');
    }
    if (is_wsgi) {
        const environ = buildEnviron(request);
        const data = [];
        const write = (bytes) => data.push(bytes);
        let status = 0;
        const headers = {}
        const startResponse = (status1, headers1, exc_info) => {
            if (exc_info) {
                return new Response("Error", {status: 502});
            }
            status = parseInt(status1.match(/^(\d+)/)[0]);
            for (const [k, v] of headers1) {
                headers[k] = v;
            }
            return write;
        }
        const result = app(environ, startResponse);

        return new Response(result, {status, headers});
    } else {

    }
    begin = performance.now();
    const result = await pyodide.runPythonAsync(`' '.join(['hello', 'world', 'from', 'python', '!'])`);
    end = performance.now();
    console.log(`execute python in ${(end-begin).toFixed(2)}ms`)
    const response = new Response(result, {
        status: 200,
        headers: {"Content-Type": "text/plain; charset=utf-8"},
    });
    return response;
}

self.addEventListener('fetch', async e => {
    e.respondWith(handleFetch(e));
});