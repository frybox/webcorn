import { startServer } from "webcorn/server";

const appUrl = new URL('app', self.location).href;
const consoleDom = document.getElementById('console');
const options = {
        serverName: 'project_django',
        projectRoot: '/opt/project_django',
        appSpec: 'project_django.wsgi:application',
        appUrl,
        consoleDom,
}
startServer(options);