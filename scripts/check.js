import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function check(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const directory of ['web', 'test', 'support', 'scripts']) {
  for (const file of await readdir(directory, { recursive: true })) {
    if (file.endsWith('.js')) check(process.execPath, ['--check', `${directory}/${file}`]);
  }
}
for (const directory of ['deploy', 'scripts']) {
  for (const file of await readdir(directory)) {
    if (file.endsWith('.sh')) check('bash', ['-n', `${directory}/${file}`]);
    if (file.endsWith('.py')) check('python3', ['-c', 'import ast,sys; ast.parse(sys.argv[1])', await readFile(`${directory}/${file}`, 'utf8')]);
  }
}
console.log('Syntax checks passed.');
