import shutil
import subprocess

subprocess.run([shutil.which('npm'), 'run', 'build'])
print("remove dist directory...")
shutil.rmtree('dist', ignore_errors=True)
print("copy server files...")
shutil.copytree('../../dist/server', 'dist/project_flask/server')
print("copy service-worker.mjs...")
shutil.copy('../../dist/service-worker.mjs', 'dist')
print("copy style.css...")
shutil.copy('../../dist/style.css', 'dist')
print("generate project_flask.zip...")
shutil.make_archive('dist/project_flask', 'zip', 'public', 'project_flask')
print("install fryweb and flask...")
subprocess.run([shutil.which('pip'), 'install', 'fryweb', 'flask'])
print('run fry server...')
subprocess.run([shutil.which('fry'), 'run'])