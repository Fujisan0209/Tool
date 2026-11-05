# Python: あいさつ・合計・FizzBuzz
# 実行: python3 hello.py

print("こんにちは、Python!")

total = sum(range(1, 11))
print(f"1から10の合計: {total}")

for i in range(1, 16):
    if i % 15 == 0:
        print("FizzBuzz")
    elif i % 3 == 0:
        print("Fizz")
    elif i % 5 == 0:
        print("Buzz")
    else:
        print(i)
