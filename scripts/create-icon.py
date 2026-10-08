"""Generate MML's original geometric Windows icon. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
out = root / 'build'
out.mkdir(exist_ok=True)
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 248, 248), radius=48, fill='#191e19')
draw.polygon([(48, 48), (172, 48), (208, 84), (208, 208), (84, 208), (48, 172)], fill='#efb66b')
draw.polygon([(76, 170), (76, 84), (96, 84), (128, 126), (160, 84), (180, 84), (180, 170), (159, 170), (159, 119), (128, 158), (97, 119), (97, 170)], fill='#242c22')
image.save(out / 'icon.png')
image.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
