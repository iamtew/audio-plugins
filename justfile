# Stupid Audio catalog — copy plugin logos from sibling checkouts.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
    @just --list

# Pull logos from ../TEW03 .. ../F4RT into assets/. TEW03 ships icon.png; the rest ship logo.png.
logos:
    Copy-Item ..\TEW03\assets\icon.png assets\tew03-icon.png -Force
    Copy-Item ..\K1X\assets\logo.png assets\k1x-logo.png -Force
    Copy-Item ..\5HKR\assets\logo.png assets\5hkr-logo.png -Force
    Copy-Item ..\V4JB\assets\logo.png assets\v4jb-logo.png -Force
    Copy-Item ..\F4RT\assets\logo.png assets\f4rt-logo.png -Force
