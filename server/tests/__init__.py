import os

# The tests never contact IBM, even when this machine has a saved account.
os.environ['KBIT_IBM_ACCOUNT'] = '0'
