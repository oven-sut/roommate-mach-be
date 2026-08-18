/**
 * `serverless.ts` installs a `process.emitWarning` filter at import time, so
 * each test puts a stand-in for Node's emitter underneath it and checks what
 * the filter lets through.
 */
describe('serverless warning filter', () => {
  const originalEmitWarning = process.emitWarning;
  let nodeEmit: jest.Mock;

  beforeEach(() => {
    nodeEmit = jest.fn();
    (process as { emitWarning: unknown }).emitWarning = nodeEmit;

    // Importing wraps whatever emitWarning is currently in place. `require`
    // is deliberate: the module has to be re-evaluated for each test, which
    // a static import cannot do.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./serverless');
    });
  });

  afterEach(() => {
    process.emitWarning = originalEmitWarning;
  });

  it('drops the DEP0169 warning that Vercel triggers, in options form', () => {
    process.emitWarning('url.parse() is deprecated', {
      code: 'DEP0169',
      type: 'DeprecationWarning',
    });

    expect(nodeEmit).not.toHaveBeenCalled();
  });

  it('drops it in the type-and-code form too', () => {
    process.emitWarning(
      'url.parse() is deprecated',
      'DeprecationWarning',
      'DEP0169',
    );

    expect(nodeEmit).not.toHaveBeenCalled();
  });

  it('drops it when the code is on the Error itself', () => {
    const warning = Object.assign(new Error('url.parse() is deprecated'), {
      code: 'DEP0169',
    });

    process.emitWarning(warning);

    expect(nodeEmit).not.toHaveBeenCalled();
  });

  it('lets a different deprecation through', () => {
    // Silencing every deprecation would hide the ones worth acting on.
    process.emitWarning('something else', {
      code: 'DEP0040',
      type: 'DeprecationWarning',
    });

    expect(nodeEmit).toHaveBeenCalledTimes(1);
  });

  it('lets an ordinary warning through untouched', () => {
    process.emitWarning('a plain warning');

    expect(nodeEmit).toHaveBeenCalledWith('a plain warning');
  });
});
