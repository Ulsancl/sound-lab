const { parentPort } = require('node:worker_threads');

parentPort.once('message', async input => {
  try {
    const { parseProject, serializeProject } = await import('../src/project.js');
    const project = parseProject(input);
    parentPort.postMessage({ project, contents: typeof input === 'string' ? serializeProject(project) : undefined });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
