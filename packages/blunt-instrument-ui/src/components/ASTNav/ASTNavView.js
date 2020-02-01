import React from 'react';
import './ASTNav.css';

function locString({ start, end }) {
  return '' + start.line + ':' + start.column + '-' +
    end.line + ':' + end.column;
}

function ASTObjectView({
  highlightedNodeId,
  object,
  onHoveredNodeChange,
  onNodeSelectedToggle,
  selectedNodeIds,
}) {
  const {
    biId: nodeId,
    type,
    loc,
    // eslint-disable-next-line no-unused-vars
    start,
    // eslint-disable-next-line no-unused-vars
    end,
    // eslint-disable-next-line no-unused-vars
    codeSlice,
    ...rest
  } = object;

  const typeEl = type ? <span className="type">{type}</span> : null;
  const nodeIdEl = nodeId ? <span className="nodeId">{nodeId}</span> : null;
  const locEl = loc ? <span className="loc">{locString(loc)}</span> : null; //TODO

  const entries = [];

  for (const key in rest) {
    const val = rest[key];

    if ((Array.isArray(val) && val.length === 0) ||
        (typeof val === 'object' && (val == null || Object.keys(val).length === 0)) ||
        typeof val === 'undefined') {
      // don't display it
    }
    else if (Array.isArray(val)) {
      entries.push([1, key,
        <ol>
          {val.map((item, index) => (
            <li key={index}>
              <ASTObjectView object={item}
                             highlightedNodeId={highlightedNodeId}
                             onHoveredNodeChange={onHoveredNodeChange}
                             onNodeSelectedToggle={onNodeSelectedToggle}
                             selectedNodeIds={selectedNodeIds} />
            </li>
          ))}
        </ol>
      ]);
    } else if (typeof val === 'object' && val != null) {
      entries.push([1, key,
        <ASTObjectView object={val}
                       highlightedNodeId={highlightedNodeId}
                       onHoveredNodeChange={onHoveredNodeChange}
                       onNodeSelectedToggle={onNodeSelectedToggle}
                       selectedNodeIds={selectedNodeIds} />
      ]);
    } else {
      entries.push([0, key, <span className="primitive">{JSON.stringify(val)}</span>]);
    }
  }

  entries.sort();

  const handleMouseOver = nodeId && onHoveredNodeChange ? (event) => {
    onHoveredNodeChange(nodeId);
    event.stopPropagation();
  } : null;

  const handleClick = nodeId && onNodeSelectedToggle ? (event) => {
    onNodeSelectedToggle(nodeId);
    event.stopPropagation();
  } : null;

  const className = [
    'object',
    nodeId ? 'node' : null,
    nodeId && nodeId === highlightedNodeId ? 'highlighted' : null,
    nodeId && selectedNodeIds.includes(nodeId) ? 'selected' : null,
  ].join(' ');

  return (
    <div className={className} onMouseOver={handleMouseOver} onClick={handleClick}>
      {nodeIdEl} {typeEl} {locEl}
      <dl>
        {entries.map(([_, key, val], index) =>
          [
            <dt key={'k' + index}>{key}</dt>,
            <dd key={'v' + index}>{val}</dd>
          ]
        )}
      </dl>
    </div>
  );
}

function ASTNavView({
  ast,
  highlightedNodeId,
  onHoveredNodeChange = null,
  onNodeSelectedToggle = null,
  selectedNodeIds,
}) {
  const clearHover = onHoveredNodeChange ? () => onHoveredNodeChange(null) : null;

  return (
    <div className="ASTNav" onMouseLeave={clearHover}>
      <ASTObjectView object={ast}
                     highlightedNodeId={highlightedNodeId}
                     onHoveredNodeChange={onHoveredNodeChange}
                     onNodeSelectedToggle={onNodeSelectedToggle}
                     selectedNodeIds={selectedNodeIds} />
    </div>
  );
}

export default ASTNavView;