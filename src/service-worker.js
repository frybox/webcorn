import * as Comlink from "comlink";

//import { loadPyodide } from "./pyodide.mjs";
// 静态加载pyodide.asm.js，否则在loadPyodide时将会动态加载，在module类型service worker中不支持动态加载
//import "./pyodide.asm.js";

// self.location代表了service-worker.mjs文件的路径
console.log(`enter service-worker.js from location: ${location}`);

console.log(`self.registration.scope is ${self.registration.scope}`);

const joinUrl = (base, sub) => {
    const url = new URL(base);

    const path = sub.replace(/^\/+|\/+$/g, '');
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.pathname += '/' + path;
    return url.toString();
}

function clientEndPoint(client) {
    return {
        addEventListener: self.addEventListener.bind(self),
        removeEventListener: self.removeEventListener.bind(self),
        postMessage: client.postMessage.bind(client),
    }
}


const currentVersion = 'v1';
const addResourcesToCache = async (resources) => {
    const cache = await self.caches.open(currentVersion);
    await cache.addAll(resources);
};

self.addEventListener('install', async e => {
    // scope是一个字符串格式的URL，如：http://localhost:8080/webcorn/
    const scope = self.registration.scope;
    console.log(`installing service worker: ${scope}`)

    e.waitUntil(
        addResourcesToCache([
            joinUrl(scope, 'config'),
            joinUrl(scope, 'server.html'),
            joinUrl(scope, 'server.mjs'),
        ])
    )
    //await self.skipWaiting();
});

const deleteOldCaches = async () => {
    const keyList = await self.caches.keys();
    const cachesToDelete = keyList.filter(key => key !== currentVersion);
    const deletes = cachesToDelete.map(async (key) => await self.caches.delete(key));
    await Promise.all(deletes);
}

self.addEventListener('activate', async event => {
    console.log("activating service worker")
    event.waitUntil(deleteOldCaches());
    //await self.clients.claim();
});

self.addEventListener('fetch', async e => {
    e.respondWith(handleFetch(e));
});

let serverEndPoint;

const handleFetch = async event => {
    const url = new URL(event.request.url);

    const method = event.request.method;
    const scheme = url.protocol.slice(0, -1);
    const hostname = url.hostname;
    const port = url.port;
    const path = url.pathname;

    const scope = new URL(self.registration.scope);

    console.log(`service worker: fetch received ${event.request.url}, ${self.registration.scope}`)

    const serverConfigUrl = joinUrl(scope, 'server/config');

    const serverReadyUrl = joinUrl(scope, 'server/ready');

    const appUrl = joinUrl(scope, 'app');


    if (method === 'GET' && url.href === serverConfigUrl) {
        return await self.caches.match(event.request);
    } else if (method === 'GET' && url.href === serverReadyUrl) {
        if (!serverEndPoint) {
            const client = await self.clients.get(event.clientId);
            serverEndPoint = clientEndPoint(client);
        }
        serverEndPoint.lastUpdateTime = Date.now(); // epoch开始的毫秒数
        return new Response('Ok', {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            }
        });
    }


    if (path.startsWith('/webcorn/') && path.endsWith('/__start')){
        const app = path.slice('/webcorn/'.length, -'/__start'.length);
        console.log(`service worker: register webcorn server ${app}`);
    } else if (path === '/webcorn/webcorn.mjs') {
        console.log(`service worker: start webcorn server ${app}`);
        return await fetch(path);
    } else if (path === '/webcorn/server') {
        console.log(`create webcorn-server`);
        const body = `
        <a href="/webcorn/foo">/webcore/foo</a>
        <a href="/foo">/foo</a>
        <script src="/webcorn-server.js"></script>
        `;
        return new Response(body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                }
            }
        );
    } else if (path === '/webcorn/project_wsgi') {
        /*
        const body = `
        <h1>/webcorn/project_wsgi</h1>
        <div>创建两个worker！</div>
        <script>
            const worker1 = new Worker('/webcorn/webcorn.mjs', {type: 'module', name: 'wsgi.worker1-from-service.worker'});
            worker1.postMessage({type: 'webcorn.start', appRoot: '/webcorn/project_wsgi'});
            const worker2 = new Worker('/webcorn.mjs', {type: 'module', name: 'wsgi.worker2-from-service.worker'});
            worker2.postMessage({type: 'webcorn.start', appRoot: '/webcorn/project_wsgi'});
        </script>
        `;
        */
        const body = '<h1>Hello project_wsgi</h1>'
        return new Response(body, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
            }
        })
    }

    return new Response(`OKK: ${path}`, {
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

const getRequest = async event => {
    const url = new URL(event.request.url);
    const method = event.request.method;
    const scheme = url.protocol.slice(0, -1);
    const server = url.hostname;
    const port = url.port;
    const path = url.pathname;
    const query = url.search ? url.search.slice(1) : '';
    const headers = {};
    for (const [k, v] of event.request.headers) {
        if (k in headers) {
            headers[k] += ','+v;
        } else {
            headers[k] = v;
        }
    }
    const body = await request.arrayBuffer();

    let request = {
        method,
        scheme,
        server,
        port,
        path,
        query,
        headers,
        body
    };
    
    request = Comlink.transfer(request, [request.body]);
    return request;
}

const handleFetch1 = async event => {

    console.log(`service worker: fetch received ${path}, ${event.request.url}`)

    if (path.startsWith('/webcorn/') && path.endsWith('/__start')){
        const app = path.slice('/webcorn/'.length, -'/__start'.length);
        console.log(`service worker: register webcorn server ${app}`);
    } else if (path === '/webcorn/webcorn.mjs') {
        console.log(`service worker: start webcorn server ${app}`);
        return await fetch(path);
    } else if (path === '/webcorn/server') {
        console.log(`create webcorn-server`);
        const body = `
        <a href="/webcorn/foo">/webcore/foo</a>
        <a href="/foo">/foo</a>
        <script src="/webcorn-server.js"></script>
        `;
        return new Response(body, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                }
            }
        );
    } else if (path === '/webcorn/project_wsgi') {
        /*
        const body = `
        <h1>/webcorn/project_wsgi</h1>
        <div>创建两个worker！</div>
        <script>
            const worker1 = new Worker('/webcorn/webcorn.mjs', {type: 'module', name: 'wsgi.worker1-from-service.worker'});
            worker1.postMessage({type: 'webcorn.start', appRoot: '/webcorn/project_wsgi'});
            const worker2 = new Worker('/webcorn.mjs', {type: 'module', name: 'wsgi.worker2-from-service.worker'});
            worker2.postMessage({type: 'webcorn.start', appRoot: '/webcorn/project_wsgi'});
        </script>
        `;
        */
        const body = '<h1>Hello project_wsgi</h1>'
        return new Response(body, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
            }
        })
    }

    return new Response(`OKK: ${path}`, {
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

const handleFetch0 = async event => {
    console.log("fetch received by service worker");
    const request = event.request;
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
