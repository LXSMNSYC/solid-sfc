import * as solid from 'solid-js';
import { NodePath, PluginObj, Visitor } from '@babel/core';
import * as t from '@babel/types';
import solidLabelsPlugin from 'babel-plugin-solid-labels';

declare global {
  function $props<T>(): T;
  function $view<T>(value: solid.JSX.Element): solid.Component<T>
}

declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'solid:fragment': { name: string, children: solid.JSX.Element };
      'solid:slot': { name: string };
      'solid:children': unknown;
      'solid:self': unknown;
    }
  }
}

function findValidParentElement(path: NodePath<t.Node>): t.JSXElement {
  if (path.parentPath) {
    if (t.isJSXElement(path.parentPath.node)) {
      return path.parentPath.node;
    }
    return findValidParentElement(path.parentPath);
  }
  throw new Error('Missing parent JSXElement');
}

const VIEW = '$view';
const PROPS = '$props';

const NAMESPACE = 'solid';
const SOLID_FRAGMENT = 'fragment';
const SOLID_SLOT = 'slot';
const SOLID_CHILDREN = 'children';
const SOLID_SELF = 'self';

function replaceNamespacedElements(
  propsId: t.Identifier,
  componentId: t.Identifier,
): Visitor {
  return {
    JSXElement(path) {
      const { openingElement } = path.node;
      const id = openingElement.name;
      if (t.isJSXNamespacedName(id) && id.namespace.name === NAMESPACE) {
        if (id.name.name === SOLID_CHILDREN) {
          path.replaceWith(
            t.jsxExpressionContainer(
              t.memberExpression(
                propsId,
                t.identifier('children'),
              ),
            ),
          );
          return;
        }
        if (id.name.name === SOLID_SLOT) {
          const attrs = openingElement.attributes;
          let nameAttr: t.JSXAttribute | undefined;
          for (let i = 0, len = attrs.length; i < len; i += 1) {
            const attr = attrs[i];
            if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'name') {
              nameAttr = attr;
              break;
            }
          }
          if (!nameAttr) {
            throw new Error('Missing name attribute');
          }
          if (!nameAttr.value) {
            throw new Error('Missing name attribute value');
          }
          const expr = t.isJSXExpressionContainer(nameAttr.value)
            ? nameAttr.value.expression
            : nameAttr.value;
          path.replaceWith(
            t.jsxFragment(
              t.jsxOpeningFragment(),
              t.jsxClosingFragment(),
              [
                t.jsxExpressionContainer(
                  t.memberExpression(
                    propsId,
                    t.isJSXEmptyExpression(expr) ? t.booleanLiteral(true) : expr,
                    true,
                  ),
                ),
              ],
            ),
          );
        }
        if (id.name.name === SOLID_FRAGMENT) {
          const validParent = findValidParentElement(path);
          const attrs = openingElement.attributes;
          let nameAttr: t.JSXAttribute | undefined;
          for (let i = 0, len = attrs.length; i < len; i += 1) {
            const attr = attrs[i];
            if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'name') {
              nameAttr = attr;
              break;
            }
          }
          if (!nameAttr) {
            throw new Error('Missing name attribute');
          }
          if (!nameAttr.value) {
            throw new Error('Missing name attribute value');
          }
          if (!t.isStringLiteral(nameAttr.value)) {
            throw new Error('Expected StringLiteral');
          }
          validParent.openingElement.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier(nameAttr.value.value),
              t.jsxFragment(
                t.jsxOpeningFragment(),
                t.jsxClosingFragment(),
                path.node.children,
              ),
            ),
          );
          path.remove();
        }
        if (id.name.name === SOLID_SELF) {
          const compId = t.jSXIdentifier(componentId.name);
          path.node.openingElement.name = compId;
          if (path.node.closingElement) {
            path.node.closingElement.name = compId;
          }
        }
      }
    },
  };
}

function checkSolidSFCDirective(node: t.Program): boolean {
  for (let i = 0, len = node.directives.length; i < len; i += 1) {
    if (node.directives[i].value.value === 'use solid-sfc') {
      return true;
    }
  }
  return false;
}

export default function solidSFCPlugin(): PluginObj {
  return {
    name: 'solid-sfc',
    inherits: solidLabelsPlugin,
    visitor: {
      Program(path, context) {
        const isValidName = context.filename != null && /\.solid\.((t|j)sx?)$/.test(context.filename);
        const shouldRun = isValidName || checkSolidSFCDirective(path.node);

        if (shouldRun) {
          const imports: t.ImportDeclaration[] = [];
          const statements: t.Statement[] = [];
          let exportDefaults: t.Expression | undefined;

          for (let i = 0, len = path.node.body.length; i < len; i += 1) {
            const node = path.node.body[i];
            if (t.isImportDeclaration(node)) {
              imports.push(node);
            } else if (t.isExportDefaultDeclaration(node) && t.isExpression(node.declaration)) {
              exportDefaults = node.declaration;
            } else {
              statements.push(node);
            }
          }

          const componentId = t.identifier('Component$$');
          const propsId = path.scope.generateUidIdentifier('props');

          if (exportDefaults) {
            path.traverse({
              CallExpression(childPath) {
                if (t.isIdentifier(childPath.node.callee) && childPath.node.callee.name === PROPS) {
                  childPath.replaceWith(propsId);
                }
              },
              ExportDefaultDeclaration(childPath) {
                if (exportDefaults === childPath.node.declaration) {
                  childPath.traverse(replaceNamespacedElements(propsId, componentId));
                }
              },
            });
          }

          if (
            t.isCallExpression(exportDefaults)
            && t.isIdentifier(exportDefaults.callee)
            && exportDefaults.callee.name === VIEW
            && t.isExpression(exportDefaults.arguments[0])
          ) {
            const argument = exportDefaults.arguments[0];
            if (t.isExpression(argument)) {
              exportDefaults = argument;
            }
          }

          path.node.body = [
            ...imports,
            t.functionDeclaration(
              componentId,
              [
                propsId,
              ],
              t.blockStatement([
                ...statements,
                t.returnStatement(
                  exportDefaults,
                ),
              ]),
            ),
            t.exportDefaultDeclaration(
              componentId,
            ),
          ];

          path.scope.crawl();
        }
      },
    },
  };
}
