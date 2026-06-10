# Programmatic Icon Generator for Destopian AdBlocker Pro (Pure Python)
import os
import zlib
import struct

def is_in_shield(px, py, scale=1.0):
    sx = px / scale
    sy = py / scale
    if abs(sx) > 0.8:
        return False
    # Shield curves
    top_y = -0.75 + 0.1 * (sx ** 2)
    bottom_y = 0.85 - 1.45 * (abs(sx) ** 1.8)
    return top_y <= sy <= bottom_y

def dist_to_segment(px, py, ax, ay, bx, by):
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    
    ab_len_sq = abx*abx + aby*aby
    if ab_len_sq == 0:
        return (apx*apx + apy*apy) ** 0.5
        
    t = (apx*abx + apy*aby) / ab_len_sq
    t = max(0.0, min(1.0, t))
    
    projx = ax + t * abx
    projy = ay + t * aby
    
    return ((px - projx)**2 + (py - projy)**2) ** 0.5

def is_in_checkmark(px, py):
    # Checkmark segments
    d1 = dist_to_segment(px, py, -0.28, 0.05, -0.06, 0.28)
    d2 = dist_to_segment(px, py, -0.06, 0.28, 0.32, -0.18)
    return min(d1, d2) < 0.075

def sample_pixel(px, py):
    # Shield shape check
    if is_in_shield(px, py, 1.0):
        if not is_in_shield(px, py, 0.85):
            # Glowing neon border (emerald green to cyber blue gradient)
            factor = (py + 0.8) / 1.6
            factor = max(0.0, min(1.0, factor))
            r = int(0 * (1 - factor) + 0 * factor)
            g = int(245 * (1 - factor) + 217 * factor)
            b = int(160 * (1 - factor) + 245 * factor)
            return (r, g, b, 255)
        else:
            # Inside the shield
            if is_in_checkmark(px, py):
                # Neon emerald checkmark
                return (0, 245, 160, 255)
            else:
                # Deep dark grey/charcoal gradient background
                factor = (py + 0.8) / 1.6
                factor = max(0.0, min(1.0, factor))
                r = int(18 * (1 - factor) + 10 * factor)
                g = int(22 * (1 - factor) + 12 * factor)
                b = int(32 * (1 - factor) + 18 * factor)
                return (r, g, b, 255)
    else:
        # Transparent outside
        return (0, 0, 0, 0)

def generate_pixel_data(width, height):
    pixels = bytearray()
    samples = [-0.33, 0.0, 0.33]
    
    for y in range(height):
        for x in range(width):
            r_sum, g_sum, b_sum, a_sum = 0, 0, 0, 0
            for dx in samples:
                for dy in samples:
                    spx = ((x + 0.5 + dx) - width/2) / (width/2)
                    spy = ((y + 0.5 + dy) - height/2) / (height/2)
                    sr, sg, sb, sa = sample_pixel(spx, spy)
                    
                    r_sum += sr * sa
                    g_sum += sg * sa
                    b_sum += sb * sa
                    a_sum += sa
            
            if a_sum > 0:
                r_final = int(r_sum / a_sum)
                g_final = int(g_sum / a_sum)
                b_final = int(b_sum / a_sum)
                a_final = int(a_sum / 9)
            else:
                r_final, g_final, b_final, a_final = 0, 0, 0, 0
                
            pixels.append(r_final)
            pixels.append(g_final)
            pixels.append(b_final)
            pixels.append(a_final)
            
    return bytes(pixels)

def save_png(filename, width, height, pixels):
    png = b'\x89PNG\r\n\x1a\n'
    
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    
    def make_chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
        
    png += make_chunk(b'IHDR', ihdr_data)
    
    scanlines = b''
    row_bytes = width * 4
    for y in range(height):
        scanlines += b'\x00' + pixels[y * row_bytes : (y + 1) * row_bytes]
        
    idat_data = zlib.compress(scanlines)
    png += make_chunk(b'IDAT', idat_data)
    png += make_chunk(b'IEND', b'')
    
    with open(filename, 'wb') as f:
        f.write(png)

def main():
    os.makedirs('icons', exist_ok=True)
    sizes = [16, 32, 48, 128]
    
    for size in sizes:
        print(f"Generating icon {size}x{size}...")
        pixels = generate_pixel_data(size, size)
        save_png(f"icons/icon{size}.png", size, size, pixels)
    
    print("All icons successfully generated in the 'icons/' directory!")

if __name__ == '__main__':
    main()
