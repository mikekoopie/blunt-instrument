import template from '@babel/template';
import * as types from '@babel/types';
import { addNodeIdsToAST, copyNodeId, getNodeId, setNodeId } from 'blunt-instrument-ast-utils';

const transcriberTemplates = {};
transcriberTemplates.none = template(`
  %%instrumentationId%%.transcribeValue = (value) => {
    return value;
  };
`);

transcriberTemplates.simple = template(`
  %%instrumentationId%%.transcribeValue = (value) => {
    switch (typeof value) {
      case 'object':
        return JSON.parse(JSON.stringify(value));
      default:
        return value;
    }
  };
`);

const buildInstrumentationInit = template(`
  const %%instrumentationId%% = {
    ast: JSON.parse(%%astString%%),
    trace: []
  };
`);

const buildRecordTrevInit = template(`
  %%instrumentationId%%.recordTrev = (type, nodeId, data) => {
    %%instrumentationId%%.trace.push({
      id: %%instrumentationId%%.trace.length + 1,
      nodeId,
      type,
      data: %%instrumentationId%%.transcribeValue(data),
    });
    return data;
  };
`);

const buildAssignOutput = template(`
  %%assignTo%% = %%instrumentationId%%;
`);

const buildExportOutput = template(`
  export const %%exportAs%% = %%instrumentationId%%;
`);

const buildReturnOutput = template(`
  return %%instrumentationId%%;
`);

/**
 * Adds initialization code for blunt-instrument to the given AST.
 * @param {NodePath} path - path containing the root node of the AST
 * @param {object} opts
 * @param {object} opts.outputs
 * @param {string} opts.outputs.assignTo - if provided, code like `${assignTo} = _instrumentation;` will be generated
 * @param {string} opts.outputs.exportAs - if provided, code like `export const ${exportAs} = _instrumentation;` will be generated
 * @param {string} opts.valueTranscriber - which value copying mechanism to use, currently may be 'none' or 'simple'
 * @return {object} an object containing identifiers generated during init that will need to be used by instrumentation code
 */
function addInstrumenterInit(path,
    {
      outputs: {
        assignTo = null,
        exportAs = null,
      } = {},
      valueTranscriber = 'simple'
    }) {
  
  const ids = {
    instrumentationId: path.scope.generateUidIdentifier('instrumentation'),
  };

  const instrumentationInit = buildInstrumentationInit({
    astString: types.stringLiteral(JSON.stringify(path.node)), // TODO insert object directly instead of via json
    ...ids })
  const recordTrevInit = buildRecordTrevInit(ids);
  const transcribeValueFnInit = transcriberTemplates[valueTranscriber](ids);

  const outputDecls = [];
  if (assignTo) {
    outputDecls.push(buildAssignOutput({ assignTo, ...ids }));
  }
  if (exportAs) {
    outputDecls.push(buildExportOutput({ exportAs, ...ids }));
  }

  path.node.body.unshift(
    instrumentationInit,
    recordTrevInit,
    transcribeValueFnInit,
    ...outputDecls,
  );

  return ids;
}

const buildExpressionTrace = template(`
  %%instrumentationId%%.recordTrev('expr', %%nodeId%%, %%expression%%)
`);

/**
 * Replaces an expression node with a traced equivalent.
 * For example, rewrites `x + 1` to `_instrumentation.recordTrev('expr', 'NODEID', x + 1)`
 * @param {NodePath} path - path containing expression node 
 * @param {object} state - metadata returned from addInstrumenterInit
 */
function addExpressionTrace(path, { instrumentationId }) {
  const node = path.node;
  const trace = buildExpressionTrace({
    instrumentationId,
    nodeId: types.stringLiteral(getNodeId(node)),
    expression: node,
  });
  node.extra.biTraced = true;
  path.replaceWith(trace);
}

const basePostfixRewrite = `
  (() => {
    const %%tempId%% = %%lval%%;
    %%lval%% OPERATOR 1;
    return %%tempId%%;
  })()
`;
const postfixRewriteTemplates = {
  '++': template(basePostfixRewrite.replace('OPERATOR', '+=')),
  '--': template(basePostfixRewrite.replace('OPERATOR', '-=')),
};

const instrumentVisitor = {
  UpdateExpression(path) {
    // TODO this is super hacky, and also written when the tracing worked
    // differently, so probably can be simplified
    const op = path.node.operator[0] + '=';
    if (path.node.prefix) {
      // Change ++x to x += 1
      const replacement = types.assignmentExpression(
        op, path.node.argument, types.numericLiteral(1));
      copyNodeId(path.node, replacement);
      path.replaceWith(replacement);
    } else {
      // Change x++ to (() => { const _postfix = x; x += 1; return _postfix})()
      // TODO: currently, for x++, the original value of x is traced twice:
      // once for the AST node corresponding to 'x' and once for the node corresponding
      // to 'x++'. This seems correct (though tracing the node for 'x' at all may be
      // superfluous) since the original value is the actual value returned by the
      // expression. However, it might be desirable to add a third trace entry of
      // a different type to trace the fact that 'x' is being updated to a new value.
      const lval = path.node.argument;
      const tempId = path.scope.generateUidIdentifier('postfix');
      const replacement = postfixRewriteTemplates[path.node.operator]({ tempId, lval });
      const nodeId = getNodeId(path.node);
      path.replaceWith(replacement);
      // replaceWith appears to drop the 'extra' property, so we must set biNodeId
      // afterward, not before
      setNodeId(path.node, nodeId);
    }
  },

  Expression: {
    exit(path) {
      // Don't trace the retrieval of a method from an object.
      // In other words, this if block detects if we're looking at a node like
      // `x.y` that's part of a node like `x.y()`, and skips tracing if so.
      // Otherwise, we'd rewrite `x.y()` to something like `trace(x.y)()`, which
      // changes the semantics of the program: the former will bind `this` to `x`
      // but the latter will not.
      // I don't know how (if it's possible) to trace the value of `x.y` in this
      // scenario without either breaking the binding of `this`, or evaluating
      // `x.y` twice (which would change the program semantics if `y` is a getter).
      if (types.isMemberExpression(path.node) &&
          types.isCallExpression(path.parentPath.node) &&
          path.node === path.parentPath.node.callee) {
        return;
      }

      // Don't trace nodes without a node ID - those are nodes we added
      if (!(path.node.extra && getNodeId(path.node))) {
        return;
      }

      // If biTraced is true, we've already added tracing for this node
      if (path.node.extra.biTraced) {
        return;
      }

      // Don't trace identifiers that aren't being evaluated, e.g. the x in `x = 4`
      if (!(path.isReferenced())) {
        return;
      }
      
      addExpressionTrace(path, this.state);
    }
  }
};

const rootVisitor = {
  Program(path, misc) {
    addNodeIdsToAST(path.node, 'src-');
    const state = addInstrumenterInit(path, misc.opts);
    path.traverse(instrumentVisitor, { state });
  }
};

/**
 * Babel plugin that instruments source code for automatic tracing.
 * 
 * See README for usage and options.
 * 
 * @param {*} babel 
 */
export function bluntInstrumentPlugin(babel) {
  return {
    visitor: rootVisitor
  }
}
