// Bridge between the Python service and dist/engine.js: one JSON request on stdin, JSON lines on stdout.
// The server reuses the browser engine for rules, costs, classical solving and plan validation, so both sides never disagree.
'use strict';
const path = require('node:path');
const Engine = require(path.join(__dirname, '..', 'dist', 'engine.js'));

const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input), instance = Engine.createInstance(request.spec || {});
    const { initial, orders, rules } = request;
    if(request.action === 'problem') emit({ type:'problem', problem:instance.describe(initial, orders, rules) });
    else if(request.action === 'demo') emit({ type:'result', value:{ spec:instance.spec, ...instance.demo() } });
    else if(request.action === 'plan') emit({ type:'result', plan:instance.planFrom(initial, orders, rules, request.target, request.solver) });
    else if(request.action === 'solve') {
      const solver = instance.createSolver(initial, orders, rules, request.options || {});
      let state;
      do { state = solver.step(100); emit({ type:'progress', state }); } while(!state.done);
      emit({ type:'result', plan:solver.result() });
    } else throw new Error('Acción desconocida: ' + request.action);
  } catch(error) {
    emit({ type:'error', message:error.message });
    process.exitCode = 1;
  }
});
