"""Точка входа для PyInstaller (и для запуска без -m): python launcher.py"""
import multiprocessing

from app.main import cli

if __name__ == "__main__":
    multiprocessing.freeze_support()
    cli()
