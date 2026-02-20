import { prisma } from '@/lib/prisma';

export type CreateParseJobArgs = {
  planId?: string;
  parserVersion: string;
  model?: string;
};

export type SaveParseArtifactArgs = {
  parseJobId: string;
  artifactType: string;
  schemaVersion: string;
  json: unknown;
  validationOk: boolean;
};

export async function createParseJob(args: CreateParseJobArgs) {
  return prisma.parseJob.create({
    data: {
      planId: args.planId ?? null,
      parserVersion: args.parserVersion,
      status: 'RUNNING',
      model: args.model ?? null
    }
  });
}

export async function updateParseJobStatus(
  id: string,
  status: 'SUCCESS' | 'FAILED'
) {
  return prisma.parseJob.update({ where: { id }, data: { status } });
}

export async function saveParseArtifact(args: SaveParseArtifactArgs) {
  return prisma.parseArtifact.create({
    data: {
      parseJobId: args.parseJobId,
      artifactType: args.artifactType,
      schemaVersion: args.schemaVersion,
      json: args.json as Parameters<typeof prisma.parseArtifact.create>[0]['data']['json'],
      validationOk: args.validationOk
    }
  });
}
