# blunt-instrument-eval

This package ties together various parts of blunt-instrument to provide an easy way to take javascript code stored in a string, instrument it, evaluate it, and get the trace in a consumable format.

```javascript
import { getNodeId } from 'blunt-instrument-ast';
import { instrumentedEval } from 'blunt-instrument-eval';

const code = `
  function factorial(n) {
    return n == 1 ? 1 : n * factorial(n - 1);
  }
  factorial(5);`;

const result = instrumentedEval(code);
const recursiveCallNode = result.traceQuerier.astQuerier.getNodesByCodeSlice('factorial(n - 1)')[0];
const trevs = result.traceQuerier.query({ filters: { onlyNodeIds: getNodeId(recursiveCallNode) }});

// This will log the four values that factorial(n - 1) evaluates to during the
// course of execution:
// [1, 2, 6, 24]
console.log(trevs.map(trev => trev.data));
```

For more information on doing queries, see [blunt-instrument-trace-utils][trace-utils] and [blunt-instrument-ast-utils][ast-utils].

Note: code is evaluated in strict mode.

[trace-utils]: ../blunt-instrument-trace-utils/README.md
[ast-utils]: ../blunt-instrument-ast-utils/README.md