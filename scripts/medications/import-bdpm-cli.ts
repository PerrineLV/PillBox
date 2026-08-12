import { importBdpm, parseImportArguments } from './import-bdpm';

importBdpm(parseImportArguments(process.argv.slice(2)))
  .then((summary) => {
    console.log(
      `Snapshot créé: ${summary.specialties} spécialités, ${summary.presentations} présentations, ` +
        `${summary.orphanPresentations} présentation(s) avec CIS absent, ` +
        `${summary.genericGroups} ligne(s) de groupe générique, ` +
        `${summary.orphanGenericGroups} ligne(s) de groupe générique avec CIS absent, ` +
        `${summary.dispensingConditions} ligne(s) de condition de délivrance, ` +
        `${summary.orphanDispensingConditions} ligne(s) de condition avec CIS absent, ` +
        `${summary.controlledDispensingSpecialties} spécialité(s) détectée(s) comme concernée(s) ` +
        'par une délivrance encadrée (à confirmer par l’utilisatrice).',
    );
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
