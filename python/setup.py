"""
Setup script for Exchange Shielded SDK Python bindings.
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="exchange-shielded-sdk",
    version="0.1.0",
    author="",
    author_email="",
    description="Python bindings for Exchange Shielded Withdrawal SDK",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/example/exchange-shielded-sdk",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Security :: Cryptography",
    ],
    python_requires=">=3.8",
    install_requires=[
        # No external dependencies - uses only stdlib
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-asyncio>=0.21",
            "black>=23.0",
            "mypy>=1.0",
            "ruff>=0.1",
        ],
    },
    entry_points={
        "console_scripts": [
            "exchange-shielded=exchange_shielded_sdk.cli:main",
        ],
    },
)
