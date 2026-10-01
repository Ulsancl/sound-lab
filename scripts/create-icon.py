"""Draw the original Sound Lab icon. Pillow is a build-time tool only."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
output = root / 'resources'
output.mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((9, 9, 503, 503), radius=100, fill='#162a35', outline='#466477', width=8)
# A hollow horizontal tube: the air markers move along its axis.
draw.rounded_rectangle((66, 157, 429, 328), radius=50, fill='#667d8b', outline='#bdced5', width=7)
draw.rounded_rectangle((75, 184, 429, 299), radius=36, fill='#11242e')
for x, color in [(137, '#69d5e8'), (197, '#8ebcca'), (257, '#e9ac67'), (317, '#f4b16b')]:
    draw.rounded_rectangle((x-10, 199, x+10, 283), radius=7, fill=color)
draw.ellipse((356, 157, 440, 328), fill='#718b9b', outline='#d1dfe3', width=7)
draw.ellipse((373, 181, 424, 304), fill='#10212b', outline='#9fb7c4', width=5)
# Opposed axial arrows and a separate probe identify an observation instrument.
draw.line((146, 113, 306, 113), fill='#71deed', width=9)
draw.polygon([(130, 113), (162, 95), (162, 131)], fill='#71deed')
draw.polygon([(323, 113), (291, 95), (291, 131)], fill='#71deed')
draw.line((256, 312, 256, 383, 357, 383), fill='#f3bd75', width=11)
draw.ellipse((245, 310, 267, 332), fill='#ffda99')
draw.rounded_rectangle((350, 356, 414, 412), radius=10, fill='#294653', outline='#70dbe6', width=4)
draw.line((362, 384, 401, 384), fill='#70dbe6', width=6)
draw.rounded_rectangle((77, 420, 328, 436), radius=6, fill='#6a8393')
image.save(output / 'app.png')
image.save(output / 'app.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Created Sound Lab resources/app.png and app.ico')
