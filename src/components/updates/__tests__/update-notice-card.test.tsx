import type { UpdateNotice } from '@/domain/updates/update-notice';

import { UpdateNoticeCard } from '../update-notice-card';

const NOTICE: UpdateNotice = {
  version: '1.0.42',
  installedVersion: '1.0.41',
  downloadUrl:
    'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk',
  fallbackToReleasePage: false,
};

function render(notice: UpdateNotice): string {
  return JSON.stringify(
    UpdateNoticeCard({
      notice,
      onDownload: jest.fn(),
      onPostpone: jest.fn(),
    }),
  );
}

describe('carte de nouvelle version', () => {
  it('propose Télécharger et Plus tard et rappelle les deux versions', () => {
    const rendered = render(NOTICE);
    expect(rendered).toContain('PillBox 1.0.42 est disponible');
    expect(rendered).toContain('Vous utilisez la version 1.0.41');
    expect(rendered).toContain('Télécharger');
    expect(rendered).toContain('Plus tard');
  });

  it('annonce que l’installation reste une action explicite', () => {
    expect(render(NOTICE)).toContain('autoriser l’installation');
  });

  it('annonce le repli vers la page de release en l’absence d’APK', () => {
    const rendered = render({ ...NOTICE, fallbackToReleasePage: true });
    expect(rendered).toContain('page de la version sur GitHub');
  });
});
