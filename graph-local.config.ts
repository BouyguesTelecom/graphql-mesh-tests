// NODE_TLS_REJECT_UNAUTHORIZED=0 npx mesh-compose -c ./graph-local.config.ts

import {
  createFilterTransform,
  createPrefixTransform,
  createPruneTransform,
  createRenameFieldTransform,
  createRenameTransform,
  defineConfig,
  type MeshComposeCLISubgraphConfig,
} from '@graphql-mesh/compose-cli'
import { loadOpenAPISubgraph } from '@omnigraph/openapi'

const HATEOAS = {
  linkNameIdentifier: 'rel',
  linkPathIdentifier: 'hrefPattern',
  linkObjectIdentifier: '_links',
  linkObjectExtensionIdentifier: 'x-links',
}

const defaultTransform = (
  prefix: string,
  suffix: string,
): Partial<MeshComposeCLISubgraphConfig> => ({
  transforms: [
    // Exclude some arguments from the schema
    createFilterTransform({
      argumentFilter(_typeName, _fieldName, argName) {
        return true
      },
    }),

    // Rename field arguments
    createRenameTransform({
      argRenamer({ fieldName, argName }) {
        return argName
      },

      fieldRenamer(opts) {
        if (!suffix) {
          return ''
        }
        if (['Query', 'Mutation', 'Subscription'].includes(opts.typeName)) {
          return opts.fieldName + suffix
        }
        return ''
      },
    }),

    // Rename field names
    createRenameFieldTransform(({ fieldName }) => {
      return fieldName
    }),

    // Rename operation names
    createPrefixTransform({
      value: prefix,
    }),

    // Remove unused and empty types.
    // <https://the-guild.dev/graphql/mesh/v1/transforms/prune>
    createPruneTransform(),
  ],
})

export const subgraphs = [
  {
    ...defaultTransform('getCcakutavi', `V1`),
    sourceHandler: loadOpenAPISubgraph('getCcakutavi@1', {
      source: './specs/anon-getCcakutaviV1.openapi.yaml',
      HATEOAS,
    }),
  },
  {
    ...defaultTransform('getPsuvugisa', `V1`),
    sourceHandler: loadOpenAPISubgraph('getPsuvugisa@1', {
      source: './specs/anon-getPsuvugisaV1.openapi.yaml',
      HATEOAS,
    }),
  },
]

export const composeConfig = defineConfig({ subgraphs })
