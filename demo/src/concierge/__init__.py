"""A NANDA Demo participant built on the official ``a2a-sdk``.

Declared as a regular package rather than left implicit: without this file
setuptools treats ``concierge`` as a namespace package, ``__file__`` is ``None``,
and the ``package-data`` entry that ships the demo page is silently ignored. The
container then installs a build whose ``/ui`` cannot find its own HTML, and
nothing at build time reports it.
"""

__all__: list[str] = []
