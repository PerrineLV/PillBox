import { importBdpm, parseImportArguments } from './import-bdpm';

importBdpm(parseImportArguments(process.argv.slice(2)))
  .then((summary) => {
    console.log(
      `Snapshot créé: ${summary.specialties} spécialités, ${summary.presentations} présentations, ` +
        `${summary.orphanPresentations} présentation(s) avec CIS absent, ` +
        `${summary.genericGroups} ligne(s) de groupe générique, ` +
        `${summary.orphanGenericGroups} ligne(s) de groupe générique avec CIS absent.`,
    );
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
