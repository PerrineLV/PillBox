import HomeScreen from '../app/index';

describe('HomeScreen', () => {
  it('affiche le titre de l’application', () => {
    const screen = HomeScreen();
    const title = screen.props.children;

    expect(title.props.children).toBe('Pilulier');
  });
});
