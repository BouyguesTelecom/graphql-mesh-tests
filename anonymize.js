// Given YAML-formatted OpenAPI specs in the `./swaggers` folder,
// We want to anonymize their content before sharing with the community.
// @ts-check

const { createHash } = require('node:crypto')
const fs = require('node:fs')
const yaml = require('js-yaml')
const path = require('node:path')

/**
 * @typedef {import('openapi-types').OpenAPIV3.Document} Document
 * @typedef {import('openapi-types').OpenAPIV3.PathsObject} PathsObject
 * @typedef {import('openapi-types').OpenAPIV3.SchemaObject & {$ref?: string}} SchemaObject
 * @typedef {import('openapi-types').OpenAPIV3.ArraySchemaObject & {$ref?: string}} ArraySchemaObject
 */

const VERB_MAPPINGS = {
  creer: 'create',
  consulter: 'get',
  modifier: 'update',
  supprimer: 'delete',
  rechercher: 'search',
}

const PRESERVED_PARAMS = ['_links', '_actions', 'self', 'id', 'items']

/** @param input {string?} */
const anonymize = (input) => {
  const hash = createHash('md5').update(String(input)).digest('hex') //.substring(0, 8)
  // Convert hash to syllable-like sequences
  const vowels = 'aeiou'
  const consonants = 'bcdfgjklmnprstvz'
  let result = ''
  for (let i = 0; i < 8; i += 2) {
    const consonantIdx = parseInt(hash.substring(i, i + 1), 16) % consonants.length
    const vowelIdx = parseInt(hash.substring(i + 1, i + 2), 16) % vowels.length
    result += consonants[consonantIdx] + vowels[vowelIdx]
  }
  return result
}

/**
 * @param mapping {Record<string, string>}
 * @param value {string?}
 */
const anonymizeUsingMapping = (mapping, value) => {
  // Check if the value starts with any of the mappings
  for (const [key, val] of Object.entries(mapping)) {
    if (value?.toLowerCase().startsWith(key)) {
      // Replace key with its val equivalent and anonymize the rest
      const rest = value.substring(key.length)
      return `${val}${rest.charAt(0)}${anonymize(rest)}`
    }
  }

  // If no mapping found, just anonymize the whole id
  return `${value?.charAt(0)}${anonymize(value)}`
}

/** @param id {string?} */
const anonymizeOperationId = (id) => anonymizeUsingMapping(VERB_MAPPINGS, id)

/** @param name {string?} */
const anonymizeParam = (name) =>
  PRESERVED_PARAMS.includes(String(name)) ? String(name) : anonymize(name)

/** @param input {string?} */
const anonymizeSchemaName = (input) => `S_${anonymize(input)}`

/** @param input {string?} */
const anonymizeSchemaRef = (input) =>
  input?.startsWith('#/components/schemas/')
    ? `#/components/schemas/${anonymizeSchemaName(input.split('/').reverse()[0])}`
    : input || undefined

/**
 * @param schema {SchemaObject}
 * @return {SchemaObject}
 */
const anonymizeSchema = (schema) => {
  const result = {
    ...schema,
    description: undefined,
    ...(schema.$ref ? { $ref: anonymizeSchemaRef(schema.$ref) } : {}),
    ...(schema.enum ? { enum: schema.enum.map((str) => anonymize(str)) } : {}),
    ...(schema.required && typeof schema.required === 'boolean'
      ? { required: schema.required }
      : {}),
    ...(schema.required && schema.required.length
      ? { required: schema.required.map((str) => anonymizeParam(str)) }
      : {}),
  }

  if (schema.properties) {
    result.properties = Object.entries(schema.properties).reduce((acc, [key, prop]) => {
      acc[anonymizeParam(key)] = anonymizeSchema(prop) // Recursively process nested properties
      return acc
    }, {})
  }

  // Handle arrays with items that have schemas
  if (schema['items']) {
    result['items'] = anonymizeSchema(schema['items'])
  }
  // Handle x-links property if it exists
  if (schema['x-links']) {
    result['x-links'] = schema['x-links'].map((link) => ({
      ...link,
      rel: anonymizeParam(link.rel),
      hrefPattern: anonymizePath(link.hrefPattern),
    }))
  }
  // Handle x-actions property if it exists
  if (schema['x-actions']) {
    result['x-actions'] = schema['x-actions'].map((action) => ({
      ...action,
      rel: anonymizeParam(action.rel),
      actionPattern: anonymizePath(action.actionPattern),
    }))
  }
  // Handle discriminators and union types
  if (schema.discriminator) {
    result.discriminator = {
      propertyName: anonymizeParam(schema.discriminator.propertyName),
      mapping: Object.entries(schema.discriminator.mapping || {}).reduce((acc, [key, value]) => {
        acc[anonymize(key)] = anonymizeSchemaRef(value)
        return acc
      }, {}),
    }
  }

  // Handle oneOf, anyOf, allOf
  if (schema.oneOf) {
    result.oneOf = schema.oneOf.map(anonymizeSchema)
  }

  if (schema.anyOf) {
    result.anyOf = schema.anyOf.map(anonymizeSchema)
  }

  if (schema.allOf) {
    result.allOf = schema.allOf.map(anonymizeSchema)
  }

  return result
}

/** @param path {string?} */
const anonymizePath = (path) => {
  // Split path by '/' and preserve path parameters (those in curly braces)
  const segments = path?.split('/')
  const anonymizedSegments = segments?.map((segment) => {
    if (segment === '') {
      return ''
    }
    // Check if segment is a path parameter (starts with '{' and ends with '}')
    if (segment.startsWith('{') && segment.endsWith('}')) {
      return `{${anonymizeParam(segment.substring(1, segment.length - 1))}}` // Anonymize path parameters
    }
    return segment.charAt(0) + anonymize(segment) // Anonymize regular path segments
  })
  return anonymizedSegments?.join('/') ?? ''
}

/** @param paths {PathsObject} */
const anonymizePaths = (paths) => {
  /** @type {PathsObject} */
  const anonymizedPaths = {}

  Object.entries(paths).forEach(([path, methods]) => {
    const newPath = anonymizePath(path)
    anonymizedPaths[newPath] = {}

    Object.entries(methods).forEach(([method, operation]) => {
      // Create a new operation object without some definitions
      const {
        security,
        'x-secured-access': xSecuredAccess,
        operationId,
        ...restOperation
      } = operation

      anonymizedPaths[newPath][method] = {
        // ...restOperation,
        operationId: anonymizeOperationId(operationId),
        description: 'Anonymized',
        tags: ['tag'],
        parameters: operation.parameters
          ?.filter(
            (param) =>
              ![
                'trackerId',
                'x-request-id',
                'x-source',
                'x-action-id',
                'x-message-id',
                'x-caller-id',
                'x-process',
                'X-Version',
              ].includes(param.name),
          )
          .map((param) => ({
            ...param,
            name: anonymizeParam(param.name),
            description: 'Anonymized',
          })),
        ...(operation.requestBody && {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  $ref: anonymizeSchemaRef(
                    operation.requestBody.content['application/json'].schema['$ref'],
                  ),
                },
              },
            },
            description: 'Anonymized',
            required: operation.requestBody.required,
          },
        }),
        responses: Object.entries(operation.responses)
          .filter(([code]) => ['200', '201', '204'].includes(code))
          .reduce((acc, [code, response]) => {
            const { content } = response
            acc[Number(code)] = {
              description: `Handling ${code} responses for ${anonymizeOperationId(operationId)}`,
              ...(content && {
                content: {
                  'application/json': {
                    schema: {
                      $ref: anonymizeSchemaRef(content['application/json'].schema['$ref']),
                    },
                  },
                },
              }),
            }
            return acc
          }, {}),
        // tags: undefined,
        // description: undefined,
        // summary: undefined
      }
    })
  })

  return anonymizedPaths
}

/** @param spec {Document} */
const anonymizeSpec = (spec) => {
  // Remove some top-level definitions
  const { servers, info, tags, ...restSpec } = spec

  return {
    openapi: restSpec.openapi,
    info: {
      title: anonymizeOperationId(info.title),
      version: info?.version || '1.0.0',
      description: 'Anonymized API',
      contact: { name: '' },
    },
    tags: [{ name: 'tag' }],
    servers: [{ url: '' }],
    paths: anonymizePaths(restSpec.paths),
    components: restSpec.components
      ? {
          schemas: Object.entries(restSpec.components.schemas || {}).reduce((acc, [key, value]) => {
            acc[anonymizeSchemaName(key)] = anonymizeSchema(value)
            return acc
          }, {}),
        }
      : undefined,
  }
}

/** @param filePath {string} */
const processFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const spec = /** @type {Document} */ (yaml.load(content))
    const anonymized = anonymizeSpec(spec)

    const [fileName, version] = path.basename(filePath).split('.')[0].split(/V/)
    const outputPath = path.join(
      path.dirname(filePath),
      `anon-${anonymizeOperationId(fileName)}V${version}.openapi.yaml`,
    )

    fs.writeFileSync(outputPath, yaml.dump(anonymized, { lineWidth: -1 }))

    console.log(`Processed ${filePath} -> ${outputPath}`)
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error)
  }
}

// Process all YAML files from the swaggers directory
const swaggersDir = path.join(__dirname, '..', '..', 'specs')
fs.readdirSync(swaggersDir)
  .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
  // skip already-anonymized specs
  .filter((file) => !file.startsWith('anon-'))
  .forEach((file) => processFile(path.join(swaggersDir, file)))
